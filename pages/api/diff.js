export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    const apiUrl = `https://api.oasdiff.com/tenants/${process.env.OASDIFF_ID}/changelog`;

    const urlEncodedData = new URLSearchParams();
    urlEncodedData.append("base", req.body.base);
    urlEncodedData.append("revision", req.body.revision);

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
    res.status(200).json(result);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: error.message });
  }
}
