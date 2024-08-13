import Head from "next/head";
import { useState, ChangeEvent } from "react";
import { Option } from "fp-ts/lib/Option";

interface Schema {
  info: {
    version: string;
  };
}

export default function Home() {
  const [previousZip, setPreviousZip] = useState<File | undefined>(undefined);
  const [newZip, setNewZip] = useState<File | undefined>(undefined);
  const [changelog, setChangelog] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [workPackageNumber, setWorkPackageNumber] = useState<
    string | undefined
  >(undefined);

  const handleWorkPackageNumberChange = (e: ChangeEvent<HTMLInputElement>) => {
    setWorkPackageNumber(e.target.value);
  };

  const handleFileChange = (
    e: ChangeEvent<HTMLInputElement>,
    docSetter: React.Dispatch<React.SetStateAction<File | undefined>>
  ) => {
    const file = e.target.files ? e.target.files[0] : undefined;
    docSetter(file);
  };

  const handleReset = (e: React.MouseEvent<HTMLButtonElement>) => {
    setWorkPackageNumber(undefined);
    setPreviousZip(undefined);
    setNewZip(undefined);
    setChangelog(undefined);
    setLoading(false);
  };

  const getChangeLog = async () => {
    setLoading(true);
    setChangelog(undefined);

    if (previousZip && newZip) {
      try {
        const formData = new FormData();
        formData.append("previous", previousZip);
        formData.append("new", newZip);
        formData.append("workPackageNumber", workPackageNumber);

        const changesResponse = await fetch("/api/specs", {
          method: "POST",
          body: formData,
        });

        if (!changesResponse.ok) {
          throw new Error(`HTTP error! status: ${changesResponse.status}`);
        }

        const changelogData = await changesResponse.text();
        setChangelog(changelogData);
      } catch (error) {
        console.error("There was an error!", error);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="container mx-auto w-full h-screen p-4">
      <Head>
        <title>Change Log Generator</title>
      </Head>

      <h1 className="text-2xl font-bold mb-8">Change Log Generator</h1>

      <div className="mb-6">
        <div className="form-control w-full max-w-xs mb-2">
          <span className="label-text">Work package number</span>
        </div>

        <input
          type="text"
          placeholder="Type here"
          className="input input-bordered w-full max-w-xs"
          value={workPackageNumber}
          onChange={handleWorkPackageNumberChange}
        />
      </div>

      <div className="mb-6">
        <label className="form-control w-full max-w-xs mb-2">
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

      <div className="mb-6">
        <label className="form-control w-full max-w-xs mb-2">
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
      <div className="flex justify-start space-x-4 mb-8">
        <button className="btn btn-square" onClick={handleReset}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Reset
        </button>
        {loading ? (
          <button className="btn">
            <span className="loading loading-spinner"></span>
            loading
          </button>
        ) : (
          <button className={`btn btn-primary mb-8`} onClick={getChangeLog}>
            Generate change log
          </button>
        )}
      </div>

      {changelog && (
        <div>
          <div className="divider">CHANGE LOG</div>
          <div className="mockup-code">
            <pre>
              <code>{changelog}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
