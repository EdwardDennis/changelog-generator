import Head from "next/head";
import { useState } from "react";

export default function Home() {
  const [previousDoc, setPreviousDoc] = useState(null);
  const [newDoc, setNewDoc] = useState(null);
  const [diffResult, setDiffResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e, docSetter) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        docSetter(content);
      };
      reader.readAsText(file);
    }
  };

  const submitDiffRequest = async () => {
    setLoading(true);

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
  };

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
