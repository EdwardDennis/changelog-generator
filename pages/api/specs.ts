import JSZip from "jszip";
import { NextApiRequest, NextApiResponse } from "next";
import { applyMulterMiddleware, multerUploads } from "./middleware/multer";

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

const changes: string[] = [];
//TODO: change this to an object to account for API response

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

    const previousZip = await JSZip.loadAsync(previousZipBuffer);
    const newZip = await JSZip.loadAsync(newZipBuffer);

    const previousJsonFiles = await getJsonFilesFromZip(previousZip);
    const newJsonFiles = await getJsonFilesFromZip(newZip);

    await checkZipFilesForAdditionsAndDeletions(previousZip, newZip);

    const allFileNames = new Set([
      ...Object.keys(previousJsonFiles),
      ...Object.keys(newJsonFiles),
    ]);

    for (const fileName of allFileNames) {
      const base = previousJsonFiles[fileName];
      const revision = newJsonFiles[fileName];
      if (base && revision) {
        await getChangesFromAPI(base, revision);
      }
    }
    console.log(changes);
    res.status(200).json(changes);
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

async function checkZipFilesForAdditionsAndDeletions(
  previousZip: JSZip,
  newZip: JSZip
) {
  const previousJsonFiles = await getJsonFilesFromZip(previousZip);
  const newJsonFiles = await getJsonFilesFromZip(newZip);

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
  jsonFiles: Record<string, JsonFileContent>,
  changeType: string
) {
  const apiMethods = ["get", "post", "delete", "put", "patch"];
  const apiNumberRegex = /(API#\d+\.?)(\/API#\d+\.?)?/i;
  for (const fileName of fileNames) {
    const fileContent = jsonFiles[fileName];
    if (fileContent.paths) {
      for (const path of Object.keys(fileContent.paths)) {
        const methods = fileContent.paths[path];
        for (const method of Object.keys(methods)) {
          if (apiMethods.includes(method)) {
            const description = methods[method].description;
            const summary = methods[method].summary;
            const apiNumberInDescription = description.match(apiNumberRegex);
            const apiNumberInSummary = description.match(apiNumberRegex);

            if (apiNumberInDescription) {
              const apiNumber = apiNumberInDescription[0]
                .replace(/\./g, "")
                .toUpperCase();
              changes.push(`${apiNumber} - ${changeType}`);
            } else if (apiNumberInSummary) {
              const apiNumber = apiNumberInSummary[0]
                .replace(/\./g, "")
                .toUpperCase();
              changes.push(`${apiNumber} - ${changeType}`);
            } else {
              changes.push(`${summary} - ${changeType}`);
            }
          }
        }
      }
    }
  }
}

async function getChangesFromAPI(base, revision) {
  try {
    const apiUrl = `https://api.oasdiff.com/tenants/${process.env.OASDIFF_ID}/changelog`;

    const urlEncodedData = new URLSearchParams();
    urlEncodedData.append("base", JSON.stringify(base));
    urlEncodedData.append("revision", JSON.stringify(revision));

    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: urlEncodedData,
    });

    if (!apiResponse.ok) {
      throw new Error(`API responded with status code ${apiResponse.status}`);
    }

    const result = await apiResponse.json();
    console.log(result);

    // const groupedChanges = result.changes.reduce((acc, el) => {
    //   const key = el["operationId"];
    //   if (!acc[key]) {
    //     acc[key] = [];
    //   }
    //   acc[key].push(el);
    //   return acc;
    // }, {});

    if (result.changes.length > 0) {
      changes.push(result.changes);
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
