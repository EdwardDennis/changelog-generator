const openapiDiff = require("openapi-diff");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const source = req.body.source;
      const destination = req.body.destination;

      const result = await openapiDiff.diffSpecs({
        sourceSpec: {
          content: source,
          location: "old spec",
          format: "openapi3",
        },
        destinationSpec: {
          content: destination,
          location: "new spec",
          format: "openapi3",
        },
      });

      if (result.breakingDifferencesFound) {
        console.log("Breaking change found!");
      }

      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
