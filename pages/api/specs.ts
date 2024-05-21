import JSZip from "jszip";
import { NextApiRequest, NextApiResponse } from "next";
import { applyMulterMiddleware, multerUploads } from "./middleware/multer";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { writeFile, mkdtemp, unlink, rmdir } from "fs";
import { tmpdir } from "os";
export const config = {
  api: {
    bodyParser: false,
  },
};

interface JsonFileContent {
  paths?: Record<
    string,
    Record<string, { description?: string; summary?: string }>
  >;
}

const execAsync = promisify(exec);
const writeFileAsync = promisify(writeFile);
const mkdtempAsync = promisify(mkdtemp);
const unlinkAsync = promisify(unlink);
const rmdirAsync = promisify(rmdir);

const storedChanges: object[] = [];

const ensurePostRequest = (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return false;
  }
  return true;
};

const handleApiLogic = async (req: NextApiRequest, res: NextApiResponse) => {
  await applyMulterMiddleware(req, res, multerUploads);

  const previousZipBuffer = (req as any).files["previous"][0].buffer;
  const newZipBuffer = (req as any).files["new"][0].buffer;

  const [previousJsonFiles, newJsonFiles] = await processZipFiles(
    previousZipBuffer,
    newZipBuffer
  );

  await checkZipFilesForAdditionsAndDeletions(previousJsonFiles, newJsonFiles);

  const allFileNames = new Set([
    ...Object.keys(previousJsonFiles),
    ...Object.keys(newJsonFiles),
  ]);

  for (const fileName of allFileNames) {
    const base = previousJsonFiles[fileName];
    const revision = newJsonFiles[fileName];
    if (base && revision) {
      const output = await getChangelog(base, revision);
      if (output.error) {
        return res.status(400).json({ error: output.error });
      }
      const outputArray = JSON.parse(output.stdout);
      outputArray.map((change) => {
        const apiNumberOrSummary = getApiNumberByPath(change.path, [
          base,
          revision,
        ]);
        storedChanges.push({
          apiNumber: apiNumberOrSummary,
          description: change.text,
          path: change.path,
        });
      });
    }
  }
  res.status(200).json(storedChanges);
};

const processZipFiles = async (
  previousZipBuffer: Buffer,
  newZipBuffer: Buffer
) => {
  const [previousZip, newZip] = await Promise.all([
    JSZip.loadAsync(previousZipBuffer),
    JSZip.loadAsync(newZipBuffer),
  ]);

  const [previousJsonFiles, newJsonFiles] = await Promise.all([
    getJsonFilesFromZip(previousZip),
    getJsonFilesFromZip(newZip),
  ]);

  return [previousJsonFiles, newJsonFiles];
};

// Run a Docker command to compare JSON files
export const getChangelog = async (
  base: JsonFileContent,
  revision: JsonFileContent
) => {
  // Create a temporary directory to store the JSON files
  const tempDir = await mkdtempAsync(join(tmpdir(), "json-"));

  // Write the base and revision JSON content to temporary files
  const baseFilePath = join(tempDir, "base.json");
  const revisionFilePath = join(tempDir, "revision.json");
  await Promise.all([
    writeFileAsync(baseFilePath, JSON.stringify(base)),
    writeFileAsync(revisionFilePath, JSON.stringify(revision)),
  ]);

  // Construct the Docker command with mounted volumes
  const command = `docker run --rm -v ${baseFilePath}:/base.json -v ${revisionFilePath}:/revision.json tufin/oasdiff changelog --format=json /base.json /revision.json`;

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      throw new Error(stderr);
    }
    return { stdout };
  } catch (error) {
    return { error: error.message };
  } finally {
    // Clean up temporary files and directory
    await Promise.all([
      unlinkAsync(baseFilePath),
      unlinkAsync(revisionFilePath),
    ]).catch((cleanupError) => {
      console.error("Error cleaning up temporary files:", cleanupError);
    });

    await rmdirAsync(tempDir).catch((cleanupError) => {
      console.error("Error removing temporary directory:", cleanupError);
    });
  }
};

// Main handler function
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!ensurePostRequest(req, res)) return;

  try {
    await handleApiLogic(req, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

async function getJsonFilesFromZip(
  zip: JSZip
): Promise<Record<string, JsonFileContent>> {
  const jsonFiles: Record<string, JsonFileContent> = {};

  for (const fileName of Object.keys(zip.files)) {
    const fileData = zip.files[fileName];
    if (
      fileData.dir ||
      !fileName.endsWith(".json") ||
      !fileName.includes("spec-files/") ||
      fileName.includes("__MACOSX")
    ) {
      continue;
    }
    try {
      const relativePath = fileName.substring(
        fileName.lastIndexOf("spec-files/") + "spec-files/".length
      );
      const content = await fileData.async("string");
      jsonFiles[relativePath] = JSON.parse(content);
    } catch (error) {
      console.error(`Error parsing JSON from file "${fileName}":`, error);
      throw new Error(
        `Error parsing JSON from file "${fileName}": ${error.message}`
      );
    }
  }

  return jsonFiles;
}

function checkZipFilesForAdditionsAndDeletions(
  previousJsonFiles: { [key: string]: any },
  newJsonFiles: { [key: string]: any }
) {
  const previousFileNames = Object.keys(previousJsonFiles);
  const newFileNames = Object.keys(newJsonFiles);

  const addedFiles = newFileNames.filter(
    (name) => !previousFileNames.includes(name)
  );
  const removedFiles = previousFileNames.filter(
    (name) => !newFileNames.includes(name)
  );

  if (addedFiles.length > 0 || removedFiles.length > 0) {
    processFiles(addedFiles, newJsonFiles, "New API added");
    processFiles(removedFiles, previousJsonFiles, "API removed");
  }
}

function processFiles(
  fileNames: string[],
  swaggerDocs: Record<string, JsonFileContent>,
  changeType: string
) {
  fileNames.forEach((fileName) => {
    const fileContent = swaggerDocs[fileName];
    if (fileContent.paths) {
      Object.keys(fileContent.paths).forEach((path) => {
        const apiNumberOrSummary = getApiNumberByPath(path, [fileContent]);
        storedChanges.push({
          apiNumber: apiNumberOrSummary,
          description: changeType,
          path: path,
        });
      });
    }
  });
}

function getApiNumberByPath(
  path: string,
  swaggerDocs: Array<JsonFileContent>
): string {
  const apiMethods = ["get", "post", "delete", "put", "patch"];
  const apiNumberRegex = /(API#\d+\.?)(\/API#\d+\.?)?/i;

  const extractApiNumber = (operation) => {
    const description = operation.description;
    const summary = operation.summary;
    const apiNumberInDescription = description?.match(apiNumberRegex);
    const apiNumberInSummary = summary?.match(apiNumberRegex);

    if (apiNumberInDescription) {
      return apiNumberInDescription[0].replace(/\./g, "").toUpperCase();
    }
    if (apiNumberInSummary) {
      return apiNumberInSummary[0].replace(/\./g, "").toUpperCase();
    }
    return summary;
  };

  const apiNumber = swaggerDocs
    .flatMap((swaggerDoc) =>
      swaggerDoc.paths && swaggerDoc.paths[path]
        ? Object.entries(swaggerDoc.paths[path])
        : []
    )
    .filter(([method]) => apiMethods.includes(method.toLowerCase()))
    .map(([, operation]) => extractApiNumber(operation))
    .find((apiNumber) => apiNumber);

  return apiNumber || "Unknown API";
}

async function getWorkPackageFromJira(apiNumber: string, apiPath: string) {
  const apiUrl = "http://localhost:3000/api/jira";
  const jql = createJqlQuery(apiNumber, apiPath);

  const response = await fetchJiraData(apiUrl, jql);
  const data = await response.json();
  return data;
}

function createJqlQuery(apiNumber: string, apiPath: string): string {
  return `(
    text ~ "${apiNumber}" OR
    text ~ "${apiPath}"
  )
  AND
  text ~ "swagger"
  AND
  issuekey ~ "MI*"`;
}

async function fetchJiraData(apiUrl: string, jql: string): Promise<Response> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jql }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response;
}
