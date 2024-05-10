export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const changelog = generateChangeLog(req.body.version, req.body.changes);
  console.log("changelog: ", changelog);

  res.status(200).send(changelog);
}

function generateChangeLog(version, changes) {
  const changeLogEntries = Object.entries(changes).map(
    ([operationId, changesArray]) => {
      const changeSummary = changesArray
        .map((change, idx) => {
          return `${idx + 1}: ${change.text}`;
        })
        .join("\n");

      return `\n---\n\n### Changes to ${operationId}\n\nChange Summary:\n\n${changeSummary}\n`;
    }
  );
  console.log(changeLogEntries);
  return generateLatestChangeText(version) + changeLogEntries.join("\n");
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
