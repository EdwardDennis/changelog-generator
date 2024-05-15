import Head from "next/head";
import { useState, ChangeEvent } from "react";

interface Schema {
  info: {
    version: string;
  };
}

export default function Home() {
  const [previousZip, setPreviousZip] = useState<File | null>(null);
  const [newZip, setNewZip] = useState<File | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileChange = (
    e: ChangeEvent<HTMLInputElement>,
    docSetter: React.Dispatch<React.SetStateAction<File | null>>
  ) => {
    const file = e.target.files ? e.target.files[0] : null;
    docSetter(file);
  };

  const getChangeLog = async () => {
    setLoading(true);

    if (previousZip && newZip) {
      try {
        const formData = new FormData();
        formData.append("previous", previousZip);
        formData.append("new", newZip);

        const changesResponse = await fetch("/api/specs", {
          method: "POST",
          body: formData,
        });

        if (!changesResponse.ok) {
          throw new Error(`HTTP error! status: ${changesResponse.status}`);
        }

        // Extract the JSON data from the response
        const changesData = await changesResponse.json();

        // const changelogResponse = await fetch("/api/changelog", {
        //   method: "POST",
        //   body: changesData,
        // });

        // if (!changelogResponse.ok) {
        //   throw new Error(`HTTP error! status: ${changelogResponse.status}`);
        // }

        // const changelogData = await changelogResponse.text();
        // setChangelog(changelogData);
      } catch (error) {
        console.error("There was an error!", error);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="container mx-auto p-4">
      <Head>
        <title>Changelog Generator</title>
      </Head>

      <h1 className="text-2xl font-bold mb-6">Changelog Generator</h1>

      <div className="mb-4">
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Old Swagger specs (ZIP)</span>
          </div>
        </label>
        <input
          type="file"
          className="file-input w-full max-w-xs"
          accept=".zip"
          onChange={(e) => handleFileChange(e, setPreviousZip)}
        />
      </div>
      <div className="mb-4">
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">New Swagger specs (ZIP)</span>
          </div>
        </label>
        <input
          type="file"
          className="file-input w-full max-w-xs"
          accept=".zip"
          onChange={(e) => handleFileChange(e, setNewZip)}
        />
      </div>

      <button
        className={`btn btn-primary btn-xs sm:btn-sm md:btn-md lg:btn-lg mb-5 ${
          loading ? "loading loading-spinner" : ""
        }`}
        onClick={(e) => getChangeLog()}
        disabled={loading}
      >
        Generate changelog
      </button>
      {changelog && (
        <div className="mockup-code">
          <pre>
            <code>{changelog}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
