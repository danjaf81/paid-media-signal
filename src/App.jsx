import { useState } from "react";
import Papa from "papaparse";

function App() {
  const [files, setFiles] = useState([]);
  const [primaryKpi, setPrimaryKpi] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function profileFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: "greedy",

      complete: (result) => {
        const rawRows = result.data;

        if (!rawRows.length) {
          reject(new Error("Empty CSV"));
          return;
        }

        // Cerca l'header più plausibile nelle prime 15 righe.
        // I metadata iniziali di Google Ads hanno poche celle,
        // mentre l'header reale contiene molte colonne.
        const searchRows = rawRows.slice(0, 15);

        let headerIndex = 0;
        let bestScore = -1;

        searchRows.forEach((row, index) => {
          const nonEmptyCells = row.filter(
            (cell) =>
              String(cell ?? "").trim() !== ""
          ).length;

          if (nonEmptyCells > bestScore) {
            bestScore = nonEmptyCells;
            headerIndex = index;
          }
        });

        const columns = rawRows[headerIndex].map(
          (column) =>
            String(column ?? "").trim()
        );

        const dataRows = rawRows
          .slice(headerIndex + 1)
          .filter((row) =>
            row.some(
              (cell) =>
                String(cell ?? "").trim() !== ""
            )
          );

        const objects = dataRows.map((row) => {
          const item = {};

          columns.forEach((column, index) => {
            if (column) {
              item[column] = row[index] ?? "";
            }
          });

          return item;
        });

        // Campione distribuito: inizio, centro, fine.
        // Evita di mostrare all'AI solo le prime righe.
        const indexes = [
          0,
          1,
          Math.floor(objects.length * 0.25),
          Math.floor(objects.length * 0.5),
          Math.floor(objects.length * 0.75),
          objects.length - 2,
          objects.length - 1,
        ]
          .filter(
            (index) =>
              index >= 0 &&
              index < objects.length
          );

        const uniqueIndexes = [
          ...new Set(indexes),
        ];

        const sampleRows = uniqueIndexes.map(
          (index) => objects[index]
        );

        const metadataRows = rawRows
          .slice(0, headerIndex)
          .map((row) =>
            row
              .filter(
                (cell) =>
                  String(cell ?? "").trim() !== ""
              )
              .join(" | ")
          );

        resolve({
          filename: file.name,
          rows: objects.length,
          columns,
          metadata_rows: metadataRows,
          sample_rows: sampleRows,
	  data_rows: objects,
        });
      },

      error: reject,
    });
  });
}

  async function handleFiles(selectedFiles) {
    const csvFiles = Array.from(selectedFiles).filter((file) =>
      file.name.toLowerCase().endsWith(".csv")
    );

    if (csvFiles.length > 10) {
      setError("Maximum 10 CSV files allowed.");
      return;
    }

    setError("");
    setAudit(null);

    try {
      const profiles = await Promise.all(
        csvFiles.map(profileFile)
      );

      setFiles(profiles);
    } catch {
      setError("Could not read one or more CSV files.");
    }
  }

  async function runAudit() {
    if (!files.length || !primaryKpi) return;

    setLoading(true);
    setError("");

    try {
     const auditFiles = files.map(
     ({ data_rows, ...file }) => file
      );

      const response = await fetch(
        "http://localhost:3001/api/audit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            files: auditFiles,
            primary_kpi: primaryKpi,
            target_value:
              targetValue === ""
                ? null
                : Number(targetValue),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Data audit failed."
        );
      }

      setAudit(data);

      const normalizeResponse = await fetch(
  "http://localhost:3001/api/normalize",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files,
    }),
  }
);

const normalizedData =
  await normalizeResponse.json();

console.log(
  "NORMALIZED DATA",
  normalizedData
);


    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "40px auto",
        padding: 20,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Paid Media Signal Analyzer</h1>

      <p>
        Upload up to 10 CSV exports from Google Ads,
        Meta Ads or other paid media platforms.
      </p>

      <input
        type="file"
        accept=".csv"
        multiple
        onChange={(event) =>
          handleFiles(event.target.files)
        }
      />

      <div style={{ marginTop: 30 }}>
        <h2>What do you want to optimize?</h2>

        <select
          value={primaryKpi}
          onChange={(event) =>
            setPrimaryKpi(event.target.value)
          }
        >
          <option value="">
            Select a primary KPI
          </option>

          <option value="roas">
            ROAS
          </option>

          <option value="cpa">
            CPA / Cost per purchase
          </option>

          <option value="cpl">
            CPL / Cost per lead
          </option>

          <option value="purchases">
            Purchases
          </option>

          <option value="leads">
            Leads
          </option>

          <option value="cpc">
            CPC
          </option>

          <option value="ctr">
            CTR
          </option>

          <option value="reach">
            Reach / Awareness
          </option>
        </select>
      </div>

      {primaryKpi && (
        <div style={{ marginTop: 20 }}>
          <label>
            <strong>
              Target value (optional)
            </strong>
          </label>

          <br />

          <input
            type="number"
            step="any"
            placeholder="e.g. 3"
            value={targetValue}
            onChange={(event) =>
              setTargetValue(event.target.value)
            }
          />
        </div>
      )}

      {files.length > 0 && (
        <>
          <h2>Files loaded</h2>

          <ul>
            {files.map((file) => (
              <li key={file.filename}>
                <strong>{file.filename}</strong>
                {" — "}
                {file.rows} rows
                {" — "}
                {file.columns.length} columns
              </li>
            ))}
          </ul>

          <button
            onClick={runAudit}
            disabled={
              loading ||
              !primaryKpi
            }
          >
            {loading
              ? "Understanding data..."
              : "Understand my data"}
          </button>
        </>
      )}

      {error && (
        <p style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      {audit && (
        <section style={{ marginTop: 40 }}>
          <h2>Data Audit</h2>

          {audit.primary_kpi_analysis && (
  <div
    style={{
      border: "1px solid #ddd",
      borderRadius: 12,
      padding: 20,
      marginBottom: 30,
    }}
  >
    <h3 style={{ marginTop: 0 }}>
      Primary KPI Analysis
    </h3>

    <p>
      <strong>KPI:</strong>{" "}
      {audit.primary_kpi_analysis.kpi.toUpperCase()}
    </p>

    <p>
      <strong>Status:</strong>{" "}
      {audit.primary_kpi_analysis.status.toUpperCase()}
    </p>

    <p>
      <strong>Confidence:</strong>{" "}
      {audit.primary_kpi_analysis.confidence.toUpperCase()}
    </p>

    {audit.primary_kpi_analysis.source_fields.length > 0 && (
      <p>
        <strong>Source fields:</strong>{" "}
        {audit.primary_kpi_analysis.source_fields.join(", ")}
      </p>
    )}

    {audit.primary_kpi_analysis.target_value !== null && (
      <p>
        <strong>Target:</strong>{" "}
        {audit.primary_kpi_analysis.target_value}
      </p>
    )}

    <p>
      {audit.primary_kpi_analysis.explanation}
    </p>

    {audit.primary_kpi_analysis.missing_requirements.length > 0 && (
      <>
        <strong>Missing requirements:</strong>

        <ul>
          {audit.primary_kpi_analysis.missing_requirements.map(
            (item) => (
              <li key={item}>{item}</li>
            )
          )}
        </ul>
      </>
    )}
  </div>
)}

          <p>
            <strong>Primary KPI:</strong>{" "}
            {primaryKpi.toUpperCase()}
          </p>

          {targetValue && (
            <p>
              <strong>Target:</strong>{" "}
              {targetValue}
            </p>
          )}

          <p>
            <strong>Platform:</strong>{" "}
            {audit.platform}
          </p>

          <p>{audit.summary}</p>

          <h3>Analysis readiness</h3>

          <ul>
            {(audit.readiness || []).map(
              (item, index) => (
                <li key={index}>
                  <strong>
                    {item.area}: {item.status}
                  </strong>
                  {" — "}
                  {item.reason}
                </li>
              )
            )}
          </ul>

          <h3>Detected reports</h3>

          <ul>
            {(audit.files_detected || []).map(
              (file, index) => (
                <li key={index}>
                  <strong>{file.filename}</strong>
                  {" — "}
                  {file.report_type}
                  {" — level: "}
                  {file.level}
                  {" — "}
                  {file.relevance}
                </li>
              )
            )}
          </ul>

          <h3>Normalized metrics</h3>

          <ul>
            {(audit.normalized_metrics || []).map(
              (item, index) => (
                <li key={index}>
                  <strong>{item.metric}</strong>
                  {" ← "}
                  {item.source_fields.join(", ")}
                </li>
              )
            )}
          </ul>

          <h3>Outcomes detected</h3>

          <ul>
            {(audit.outcomes_detected || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>

          <h3>Hierarchy detected</h3>

          <ul>
            {(audit.hierarchy_detected || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>

          <h3>Dimensions available</h3>

<ul>
  {(audit.dimensions_available || []).map(
    (item) => (
      <li key={item}>{item}</li>
    )
  )}
</ul>


<h3>Settings available</h3>

<ul>
  {(audit.settings_available || []).map(
    (item, index) => (
      <li key={index}>
        <strong>{item.canonical}</strong>
        {" ← "}
        {item.source_fields.join(", ")}
      </li>
    )
  )}
</ul>


<h3>Funnel metrics available</h3>

<ul>
  {(audit.funnel_metrics_available || []).map(
    (item, index) => (
      <li key={index}>
        <strong>{item.canonical}</strong>
        {" ← "}
        {item.source_fields.join(", ")}
      </li>
    )
  )}
</ul>


<h3>Outcome fields available</h3>

<ul>
  {(audit.outcome_fields_available || []).map(
    (item, index) => (
      <li key={index}>
        <strong>{item.canonical}</strong>
        {" ← "}
        {item.source_fields.join(", ")}
      </li>
    )
  )}
</ul>


<h3>Diagnostics available</h3>

<ul>
  {(audit.diagnostics_available || []).map(
    (item) => (
      <li key={item}>{item}</li>
    )
  )}
</ul>

          <h3>Possible join keys</h3>

          <ul>
            {(audit.possible_join_keys || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>

          <h3>Missing core metrics</h3>

          <ul>
            {(audit.missing_core_metrics || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>

          <h3>Optional breakdowns missing</h3>

          <ul>
            {(audit.optional_breakdowns_missing || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>

          <h3>Recommended additional data</h3>

          <ul>
            {(audit.recommended_additional_data || []).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;