import Head from "next/head";
import { useState, ChangeEvent } from "react";

interface Schema {
  info: {
    version: string;
  };
}

export default function Home() {
  const [previousDoc, setPreviousDoc] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>, docSetter: React.Dispatch<React.SetStateAction<string | null>>) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const content = e.target?.result;
        docSetter(content as string);
      };
      reader.readAsText(file);
    }
  };

  const submitDiffRequest = async () => {
    setLoading(true);

    if (previousDoc && newDoc) {
      const response = await fetch("/api/diff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: previousDoc,
          destination: newDoc,
        }),
      });

      const data = await response.json();
      setDiffResult(data);
      setLoading(false);
      console.log("data: ", data);
    }
  };

  function formatDate(date: Date): string {
    const day = date.getUTCDate().toString().padStart(2, "0");
    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  function generateLatestChangeText(): string {
    if (newDoc) {
      const newSchema: Schema = JSON.parse(newDoc);
      const version = newSchema.info.version;
      const todaysDate = formatDate(new Date());
      return `## Latest Change ${todaysDate} ${version}`;
    }
    return '';
  }

  return (
    <div className="container mx-auto p-4">
      <Head>
        <title>Swagger Document Upload</title>
      </Head>

      <h1 className="text-2xl font-bold mb-6">Swagger Document Upload</h1>

      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Previous Swagger Doc
        </label>
        <input
          type="file"
          className="file-input file-input-bordered file-input-primary w-full max-w-xs"
          accept=".yaml,.yml,.json"
          onChange={(e) => handleFileChange(e, setPreviousDoc)}
        />
      </div>
      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          New Swagger Doc
        </label>
        <input
          type="file"
          className="file-input file-input-bordered file-input-primary w-full max-w-xs"
          accept=".yaml,.yml,.json"
          onChange={(e) => handleFileChange(e, setNewDoc)}
        />
      </div>

      <button
        className={`btn btn-xs sm:btn-sm md:btn-md lg:btn-lg ${
          loading ? "loading loading-spinner" : ""
        }`}
        onClick={(e) => submitDiffRequest()}
        disabled={loading}
      >
        Generate change log
      </button>
    </div>
  );
}
