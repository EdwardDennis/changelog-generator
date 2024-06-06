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

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: any[];
  responses?: any;
}

interface PathItemObject {
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
}

interface JsonFileContent {
  info: {
    version: string;
  };
  paths?: Record<string, PathItemObject>;
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
  let version: string | undefined;

  try {
    for (const fileName of allFileNames) {
      const base = previousJsonFiles[fileName];
      const revision = newJsonFiles[fileName];

      version = validateVersionConsistency(fileName, version, revision);

      if (base && revision) {
        await processFileChanges(base, revision);
      }
    }
    const changeLogArgs = {
      version: version,
      workPackage: req.body.workPackageNumber,
      changes: storedChanges,
    };

    console.log(storedChanges);

    handleChangeLogRequest(req, res, changeLogArgs);
  } catch (error) {
    console.error(error);
    res.status(400).json({ errorMessages: [error.message] });
  }
};

const validateVersionConsistency = (
  fileName: string,
  version: string | undefined,
  revision: any
) => {
  if (version === undefined) {
    return revision.info.version;
  } else if (version !== revision.info.version) {
    throw new Error(
      `Invalid version in ${fileName}, expected ${version} but found ${revision.info.version}`
    );
  }
  return version;
};

const processFileChanges = async (base: any, revision: any) => {
  const output = await getDiff(base, revision);
  if (output.error) {
    throw new Error(output.error);
  }
  const outputArray = JSON.parse(output.stdout);
  outputArray.forEach((change: any) => {
    console.log(change);
    const apiNumberOrSummary = getApiNumberByPath(
      change.path,
      change.operation,
      [base, revision]
    );
    storedChanges.push({
      apiNumber: apiNumberOrSummary,
      description: change.text,
      path: change.path,
    });
  });
};

// const getItsdFriendlyChangeDescription = (changeDescription: string) => {
//   switch (changeDescription) {
//     case "api-path-removed-without-deprecation":
//     case "api-path-sunset-parse":
//     case "api-path-removed-before-sunset":

//     case "api-removed-without-deprecation":
//     case "api-removed-before-sunset":
//       return "Removed ";
//   }
// };

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
export const getDiff = async (
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
    Object.keys(fileContent.paths).forEach((path) => {
      const pathObject = fileContent.paths[path];
      Object.keys(pathObject).forEach((method) => {
        //TODO: see if this works
        const apiNumberOrSummary = getApiNumberByPath(path, method, [
          fileContent,
        ]);
        storedChanges.push({
          apiNumber: apiNumberOrSummary,
          description: changeType,
          path: path,
        });
      });
    });
  });
}

function getApiNumberByPath(
  path: string,
  httpMethod: string,
  swaggerDocs: Array<JsonFileContent>
): string {
  const apiNumberRegex = /(API#\d+)/i;

  const extractApiNumber = (operation: OperationObject): string => {
    const description = operation.description;
    const summary = operation.summary;
    const apiNumberInDescription = description?.match(apiNumberRegex);
    const apiNumberInSummary = summary?.match(apiNumberRegex);

    if (apiNumberInDescription) {
      return apiNumberInDescription[0].toUpperCase();
    }
    if (apiNumberInSummary) {
      return apiNumberInSummary[0].toUpperCase();
    }
    return summary;
  };

  for (const swaggerDoc of swaggerDocs) {
    if (swaggerDoc.paths && swaggerDoc.paths[path]) {
      const operation = swaggerDoc.paths[path][httpMethod.toLowerCase()];
      if (operation) {
        return extractApiNumber(operation);
      }
    }
  }

  return "Unknown API";
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

const handleChangeLogRequest = async (
  req: NextApiRequest,
  res: NextApiResponse,
  changeLogArgs: object
) => {
  try {
    const changelogMarkdown = await getChangeLogMarkdown(changeLogArgs);
    res.status(200).send(changelogMarkdown);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function getChangeLogMarkdown(body: object) {
  const apiUrl = "http://localhost:3000/api/changelog";

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.text();
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
