import JSZip from "jszip";
import { NextApiRequest, NextApiResponse } from "next";
import { applyMulterMiddleware, multerUploads } from "./middleware/multer";
import { tryCatch, TaskEither, map, chain, fold } from "fp-ts/TaskEither";
import { pipe } from "fp-ts/function";
import { toError } from "fp-ts/Either";
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

const storedChanges: object[] = [];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    await applyMulterMiddleware(req, res, multerUploads);

    const previousZipBuffer = (req as any).files["previous"][0].buffer;
    const newZipBuffer = (req as any).files["new"][0].buffer;

    const [previousZip, newZip] = await Promise.all([
      JSZip.loadAsync(previousZipBuffer),
      JSZip.loadAsync(newZipBuffer),
    ]);

    const [previousJsonFiles, newJsonFiles] = await Promise.all([
      getJsonFilesFromZip(previousZip),
      getJsonFilesFromZip(newZip),
    ]);

    await checkZipFilesForAdditionsAndDeletions(
      previousJsonFiles,
      newJsonFiles
    );

    const allFileNames = new Set([
      ...Object.keys(previousJsonFiles),
      ...Object.keys(newJsonFiles),
    ]);

    for (const fileName of allFileNames) {
      const base: JsonFileContent = previousJsonFiles[fileName];
      const revision: JsonFileContent = newJsonFiles[fileName];
      if (base && revision) {
        pipe(
          getChangesFromAPI(base, revision),
          fold(
            (error) => () => {
              console.error("Error:", error);
              return Promise.reject(error); // Handle the error case
            },
            (changes) => () => {
              changes.forEach((change) => {
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
              return Promise.resolve(changes); // Handle the success case
            }
          )
        )();
      }
    }
    console.log(storedChanges);
    res.status(200).json(storedChanges);
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

function getChangesFromAPI(base: any, revision: any): TaskEither<Error, any> {
  return pipe(
    fetchChanges(base, revision),
    map((result) => result.changes)
  );
}

function fetchChanges(base: any, revision: any): TaskEither<Error, any> {
  const apiUrl = `https://api.oasdiff.com/tenants/${process.env.OASDIFF_ID}/changelog`;

  const urlEncodedData = new URLSearchParams();
  urlEncodedData.append("base", JSON.stringify(base));
  urlEncodedData.append("revision", JSON.stringify(revision));

  return tryCatch(
    () =>
      fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: urlEncodedData,
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`API responded with status code ${response.status}`);
        }
        return response.json();
      }),
    (reason) => toError(reason)
  );
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
