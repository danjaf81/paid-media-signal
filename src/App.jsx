import { useState } from "react";
import Papa from "papaparse";

function App() {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleFile(file) {
    setError("");
    setResult(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,

      complete: (parsed) => {
        setRows(parsed.data);
      },

      error: () => {
        setError("Could not read CSV file.");
      },
    });
  }

  async function analyze() {
    if (!rows.length) {
      setError("Upload a CSV first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "http://localhost:3001/api/analyze",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            campaigns: rows,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "40px auto", padding: 20 }}>
      <h1>Paid Media Signal Analyzer</h1>

      <p>
        Upload a Google Ads or Meta Ads campaign export and detect
        performance signals automatically.
      </p>

      <input
        type="file"
        accept=".csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div style={{ marginTop: 20 }}>
        <button
          onClick={analyze}
          disabled={!rows.length || loading}
        >
          {loading ? "Analyzing..." : "Analyze campaigns"}
        </button>
      </div>

      {rows.length > 0 && (
        <p>{rows.length} campaigns loaded</p>
      )}

      {error && (
        <p style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      {result && (
        <>
          <h2>Campaign analysis</h2>

          <table
            border="1"
            cellPadding="8"
            style={{
              borderCollapse: "collapse",
              width: "100%",
            }}
          >
            <thead>
              <tr>
                <th>Platform</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>CTR</th>
                <th>CPA</th>
                <th>ROAS</th>
                <th>Signals</th>
              </tr>
            </thead>

            <tbody>
              {result.campaigns.map((campaign) => (
                <tr key={campaign.campaign_name}>
                  <td>{campaign.platform}</td>
                  <td>{campaign.campaign_name}</td>
                  <td>{campaign.status}</td>
                  <td>{campaign.ctr.toFixed(2)}%</td>
                  <td>€{campaign.cpa.toFixed(2)}</td>
                  <td>{campaign.roas.toFixed(2)}</td>
                  <td>{campaign.signals.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.ai && (
            <>
              <h2>AI Summary</h2>
              <p>{result.ai.summary}</p>

              <h3>Priorities</h3>

              <ul>
                {result.ai.priorities.map((item, index) => (
                  <li key={index}>
                    <strong>{item.campaign_name}</strong>
                    {" — "}
                    {item.action}
                    {" — "}
                    {item.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;