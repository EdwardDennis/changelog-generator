import JSZip from "jszip";
import { NextApiRequest, NextApiResponse } from "next";
import { applyMulterMiddleware, multerUploads } from "./middleware/multer";

export const config = {
  api: {
    bodyParser: false,
  },
};

interface JsonFileContent {
  paths?: Record<string, Record<string, { description?: string }>>;
}

const changes: string[] = [];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  // Apply the multer middleware
  await applyMulterMiddleware(req, res, multerUploads);

  // Access the uploaded files as buffers
  const previousZipBuffer = (req as any).files["previous"][0].buffer;
  const newZipBuffer = (req as any).files["new"][0].buffer;

  // Load the ZIP files using JSZip
  const previousZip = await JSZip.loadAsync(previousZipBuffer);
  const newZip = await JSZip.loadAsync(newZipBuffer);

  const previousJsonFiles = await getJsonFilesFromZip(previousZip);
  const newJsonFiles = await getJsonFilesFromZip(newZip);
  await checkZipFilesForAdditionsAndDeletions(previousZip, newZip);

  const fileNames = Object.keys(newJsonFiles);
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i];
    const base = previousJsonFiles[fileName];
    const revision = newJsonFiles[fileName];
    if (base && revision) {
      await getChangesFromAPI(base, revision);
    }
  }
  console.log(changes);
  res.status(200).json(changes);
}

async function getJsonFilesFromZip(
  zip: JSZip
): Promise<Record<string, JsonFileContent>> {
  const jsonFiles: Record<string, JsonFileContent> = {};

  // Iterate over each file in the zip
  for (const fileName of Object.keys(zip.files)) {
    const fileData = zip.files[fileName];
    // Skip directories and non-JSON files
    if (
      fileData.dir ||
      !fileName.endsWith(".json") ||
      fileName.includes("__MACOSX") ||
      fileName.startsWith("._")
    ) {
      continue;
    }
    try {
      // Extract the file content as a string
      const content = await fileData.async("string");
      // Parse the JSON content and add it to the jsonFiles object
      jsonFiles[fileName] = JSON.parse(content);
    } catch (error) {
      // Log the error and the file name
      console.error(`Error parsing JSON from file "${fileName}":`, error);
      // You may choose to throw an error, return partial results, or handle the error as appropriate
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

  for (const fileName of addedFiles) {
    const fileContent = newJsonFiles[fileName];
    if (fileContent.paths) {
      for (const path of Object.keys(fileContent.paths)) {
        const methods = fileContent.paths[path];
        for (const method of Object.keys(methods)) {
          if (["get", "post", "delete", "put", "patch"].includes(method)) {
            const description = methods[method].description;
            changes.push(`${description} - New API added`);
          }
        }
      }
    }
  }

  for (const fileName of removedFiles) {
    const fileContent = previousJsonFiles[fileName];
    if (fileContent.paths) {
      for (const path of Object.keys(fileContent.paths)) {
        const methods = fileContent.paths[path];
        for (const method of Object.keys(methods)) {
          if (["get", "post", "delete", "put", "patch"].includes(method)) {
            const description = methods[method].description;
            changes.push(`${description} - API removed`);
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
    urlEncodedData.append("base", base);
    urlEncodedData.append("revision", revision);

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

    const groupedChanges = result.changes.reduce((acc, el) => {
      const key = el["operationId"];
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(el);
      return acc;
    }, {});
    changes.push(groupedChanges);
  } catch (error) {
    console.error("Error:", error);
  }
}
