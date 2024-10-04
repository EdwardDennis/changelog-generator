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

  const changelog = generateChangeLog(
    req.body.version,
    req.body.workPackage,
    req.body.changes
  );

  res.status(200).send(changelog);
}

function generateChangeLog(version, workPackage, changes) {
  const changeLogEntries = changes
    .sort((a, b) => {
      const firstApiNumberA = extractFirstApiNumber(a.apiNumber);
      const firstApiNumberB = extractFirstApiNumber(b.apiNumber);
      return firstApiNumberA - firstApiNumberB;
    })
    .map((change, idx) => {
      return `${idx + 1}. ${change.apiNumber} - ${change.description}`;
    })
    .join("\n");

  const changeLog = `\n---\n\n### ${workPackage}\n\nChange Summary:\n\n${changeLogEntries}\n`;
  return generateLatestChangeText(version) + changeLog;
}

function extractFirstApiNumber(apiNumberStr) {
  const matches = apiNumberStr.match(/API#(\d+)/);
  return matches ? parseInt(matches[1], 10) : Number.MAX_SAFE_INTEGER;
}

function formatDate(date) {
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function generateLatestChangeText(version) {
  const todaysDate = formatDate(new Date());
  return `\n## Latest Change ${todaysDate} ${version}`;
}
