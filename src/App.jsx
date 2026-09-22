import { useState } from "react";
import Papa from "papaparse";


function Accordion({
  title,
  children,
  open = false,
}) {
  return (
    <details
      open={open}
      style={{
        marginTop: 16,
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <summary
        style={{
          padding: "14px 16px",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {title}
      </summary>

      <div
        style={{
          padding: "0 16px 16px",
        }}
      >
        {children}
      </div>
    </details>
  );
}


function App() {
  const [files, setFiles] = useState([]);
  const [primaryKpi, setPrimaryKpi] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [audit, setAudit] = useState(null);
  const [performance, setPerformance] = useState(null);
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

          const indexes = [
            0,
            1,
            Math.floor(objects.length * 0.25),
            Math.floor(objects.length * 0.5),
            Math.floor(objects.length * 0.75),
            objects.length - 2,
            objects.length - 1,
          ].filter(
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
    const csvFiles = Array.from(
      selectedFiles
    ).filter((file) =>
      file.name.toLowerCase().endsWith(".csv")
    );

    if (csvFiles.length > 10) {
      setError(
        "Maximum 10 CSV files allowed."
      );
      return;
    }

    setError("");
    setAudit(null);
    setPerformance(null);

    try {
      const profiles = await Promise.all(
        csvFiles.map(profileFile)
      );

      setFiles(profiles);
    } catch {
      setError(
        "Could not read one or more CSV files."
      );
    }
  }


  async function runAudit() {
    if (!files.length || !primaryKpi) {
      return;
    }

    setLoading(true);
    setError("");
    setPerformance(null);

    try {
      const auditFiles = files.map(
        ({ data_rows, ...file }) => file
      );

      const response = await fetch(
        "http://localhost:3001/api/audit",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
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
          data.error ||
            "Data audit failed."
        );
      }

      setAudit(data);

      const normalizeResponse =
        await fetch(
          "http://localhost:3001/api/normalize",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              files,
              primary_kpi: primaryKpi,
              target_value:
                targetValue === ""
                  ? null
                  : Number(targetValue),
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


  async function runPerformance() {
    try {
      if (!audit) {
        return;
      }

      const response = await fetch(
        "http://localhost:3001/api/performance",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            files,
            audit,
            primary_kpi: primaryKpi,
            target_value:
              targetValue === ""
                ? null
                : Number(targetValue),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Performance analysis failed"
        );
      }

      const data = await response.json();

      setPerformance(data);

      console.log(
        "PERFORMANCE ANALYSIS",
        data
      );
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  }


  return (
    <main
      style={{
        maxWidth: 980,
        margin: "40px auto",
        padding: "0 20px 60px",
        fontFamily:
          "Inter, Arial, sans-serif",
        color: "#1f2937",
        lineHeight: 1.5,
      }}
    >
      {/* HEADER */}

      <header
        style={{
          marginBottom: 36,
        }}
      >
        <h1
          style={{
            marginBottom: 8,
            fontSize: 32,
          }}
        >
          Paid Media Signal Analyzer
        </h1>

        <p
          style={{
            margin: 0,
            color: "#6b7280",
            fontSize: 16,
          }}
        >
          AI-assisted analysis for Google Ads
          and Meta Ads exports.
        </p>
      </header>


      {/* STEP 1 */}

      <section
        style={{
          padding: 24,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          marginBottom: 20,
          background: "#fff",
        }}
      >
        <h2
          style={{
            marginTop: 0,
            fontSize: 20,
          }}
        >
          1. Upload data
        </h2>

        <input
          type="file"
          accept=".csv"
          multiple
          onChange={(event) =>
            handleFiles(event.target.files)
          }
        />

        <p
          style={{
            marginBottom: 0,
            color: "#6b7280",
          }}
        >
          {files.length
            ? `${files.length} CSV file${
                files.length > 1
                  ? "s"
                  : ""
              } loaded`
            : "Upload up to 10 CSV exports."}
        </p>
      </section>


      {/* STEP 2 */}

      <section
        style={{
          padding: 24,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          marginBottom: 30,
          background: "#fff",
        }}
      >
        <h2
          style={{
            marginTop: 0,
            fontSize: 20,
          }}
        >
          2. Define your objective
        </h2>

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "end",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              Primary KPI
            </label>

            <select
              value={primaryKpi}
              onChange={(event) =>
                setPrimaryKpi(
                  event.target.value
                )
              }
              style={{
                minWidth: 220,
                padding: 10,
              }}
            >
              <option value="">
                Select KPI
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

          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              Target value
            </label>

            <input
              type="number"
              step="any"
              value={targetValue}
              onChange={(event) =>
                setTargetValue(
                  event.target.value
                )
              }
              placeholder="Optional"
              style={{
                width: 160,
                padding: 10,
              }}
            />
          </div>

          <button
            onClick={runAudit}
            disabled={
              loading ||
              !files.length ||
              !primaryKpi
            }
            style={{
              padding: "11px 18px",
              border: 0,
              borderRadius: 7,
              cursor:
                loading ||
                !files.length ||
                !primaryKpi
                  ? "not-allowed"
                  : "pointer",
              background: "#111827",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {loading
              ? "Analyzing..."
              : "Run Data Audit"}
          </button>
        </div>

        {error && (
          <p
            style={{
              marginTop: 16,
              color: "#b91c1c",
            }}
          >
            {error}
          </p>
        )}
      </section>


      {/* DATA READINESS */}

      {audit && (
        <section
          style={{
            marginTop: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "start",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2
                style={{
                  marginBottom: 6,
                }}
              >
                Data Readiness
              </h2>

              <p
                style={{
                  marginTop: 0,
                  color: "#6b7280",
                }}
              >
                {audit.platform}

                {audit.files_detected
                  ?.length
                  ? ` · ${
                      audit.files_detected
                        .length
                    } report${
                      audit.files_detected
                        .length > 1
                        ? "s"
                        : ""
                    } detected`
                  : ""}
              </p>
            </div>

            <button
              onClick={runPerformance}
              style={{
                padding: "11px 18px",
                border: 0,
                borderRadius: 7,
                cursor: "pointer",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              Analyze Performance
            </button>
          </div>


          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginTop: 20,
            }}
          >
            {(audit.readiness || []).map(
              (item, index) => (
                <div
                  key={index}
                  style={{
                    padding: 16,
                    border:
                      "1px solid #e5e7eb",
                    borderRadius: 10,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280",
                    }}
                  >
                    {item.area}
                  </div>

                  <strong
                    style={{
                      display: "block",
                      marginTop: 4,
                      textTransform:
                        "uppercase",
                    }}
                  >
                    {item.status}
                  </strong>

                  <p
                    style={{
                      marginBottom: 0,
                      fontSize: 13,
                    }}
                  >
                    {item.reason}
                  </p>
                </div>
              )
            )}
          </div>


          <div
            style={{
              marginTop: 20,
              padding: 18,
              borderLeft:
                "4px solid #2563eb",
              background: "#f8fafc",
            }}
          >
            <strong>
              Primary KPI:{" "}
              {
                audit
                  .primary_kpi_analysis
                  ?.kpi
              }
            </strong>

            <p
              style={{
                marginBottom: 0,
              }}
            >
              {audit.summary}
            </p>
          </div>


          <Accordion title="View technical data audit">
            <h3>Detected reports</h3>

            <ul>
              {(audit.files_detected || []).map(
                (item, index) => (
                  <li key={index}>
                    <strong>
                      {item.filename}
                    </strong>
                    {" — "}
                    {item.report_type}
                    {" — "}
                    {item.level}
                  </li>
                )
              )}
            </ul>


            <h3>Normalized metrics</h3>

            <ul>
              {(
                audit.normalized_metrics ||
                []
              ).map((item, index) => (
                <li key={index}>
                  <strong>
                    {item.metric}
                  </strong>
                  {" ← "}
                  {item.source_fields.join(
                    ", "
                  )}
                </li>
              ))}
            </ul>


            <h3>Outcomes detected</h3>

            <ul>
              {(audit.outcomes_detected || [])
                .length > 0 ? (
                audit.outcomes_detected.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )
              ) : (
                <li>None detected</li>
              )}
            </ul>


            <h3>Dimensions</h3>

            <ul>
              {(
                audit.dimensions_available ||
                []
              ).map((item, index) => (
                <li key={index}>
                  {item}
                </li>
              ))}
            </ul>


            <h3>Settings</h3>

            <ul>
              {(
                audit.settings_available ||
                []
              ).map((item, index) => (
                <li key={index}>
                  <strong>
                    {item.canonical}
                  </strong>
                  {" ← "}
                  {item.source_fields.join(
                    ", "
                  )}
                </li>
              ))}
            </ul>


            <h3>Funnel metrics</h3>

            <ul>
              {(
                audit
                  .funnel_metrics_available ||
                []
              ).length > 0 ? (
                audit.funnel_metrics_available.map(
                  (item, index) => (
                    <li key={index}>
                      <strong>
                        {item.canonical}
                      </strong>
                      {" ← "}
                      {item.source_fields.join(
                        ", "
                      )}
                    </li>
                  )
                )
              ) : (
                <li>None detected</li>
              )}
            </ul>


            <h3>Diagnostics</h3>

            <ul>
              {(
                audit.diagnostics_available ||
                []
              ).length > 0 ? (
                audit.diagnostics_available.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )
              ) : (
                <li>None detected</li>
              )}
            </ul>


            <h3>Missing core metrics</h3>

            <ul>
              {(
                audit.missing_core_metrics ||
                []
              ).length > 0 ? (
                audit.missing_core_metrics.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )
              ) : (
                <li>None</li>
              )}
            </ul>


            <h3>
              Recommended additional data
            </h3>

            <ul>
              {(
                audit
                  .recommended_additional_data ||
                []
              ).map((item, index) => (
                <li key={index}>
                  {item}
                </li>
              ))}
            </ul>
          </Accordion>
        </section>
      )}


      {/* PERFORMANCE ANALYSIS */}

      {performance && (
        <section
          style={{
            marginTop: 50,
            paddingTop: 30,
            borderTop:
              "2px solid #e5e7eb",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <h2>
              Performance Analysis
            </h2>

            <span
              style={{
                padding: "5px 10px",
                borderRadius: 20,
                background: "#f3f4f6",
                fontSize: 13,
                fontWeight: 600,
                textTransform:
                  "uppercase",
              }}
            >
              Confidence:{" "}
              {performance.confidence}
            </span>
          </div>


          <div
            style={{
              padding: 20,
              borderRadius: 10,
              background: "#f8fafc",
              marginTop: 10,
            }}
          >
            <h3
              style={{
                marginTop: 0,
              }}
            >
              Executive Summary
            </h3>

            <p
              style={{
                marginBottom: 0,
              }}
            >
              {
                performance.executive_summary
              }
            </p>
          </div>


          <h3
            style={{
              marginTop: 34,
            }}
          >
            Key Findings
          </h3>

          {(performance.findings || []).map(
            (finding, index) => (
              <div
                key={index}
                style={{
                  marginBottom: 16,
                  padding: 20,
                  border:
                    "1px solid #e5e7eb",
                  borderRadius: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform:
                      "uppercase",
                    color: "#6b7280",
                  }}
                >
                  {finding.type}
                </span>

                <h4
                  style={{
                    marginBottom: 8,
                  }}
                >
                  {finding.title}
                </h4>

                <p>
                  {finding.analysis}
                </p>

                {finding.evidence?.length >
                  0 && (
                  <Accordion title="Evidence">
                    <ul>
                      {finding.evidence.map(
                        (
                          item,
                          evidenceIndex
                        ) => (
                          <li
                            key={
                              evidenceIndex
                            }
                          >
                            {item.entity
                              ? `${item.entity} — `
                              : ""}

                            <strong>
                              {item.metric}
                            </strong>

                            : {item.value}

                            {item.filename
                              ? ` (${item.filename})`
                              : ""}
                          </li>
                        )
                      )}
                    </ul>
                  </Accordion>
                )}
              </div>
            )
          )}


          <h3
            style={{
              marginTop: 34,
            }}
          >
            Recommended Actions
          </h3>

          {(
            performance.recommended_actions ||
            []
          ).map((item, index) => (
            <div
              key={index}
              style={{
                padding: "16px 0",
                borderBottom:
                  "1px solid #e5e7eb",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform:
                    "uppercase",
                  color: "#6b7280",
                }}
              >
                {item.priority} priority
              </span>

              <h4
                style={{
                  margin: "5px 0 6px",
                }}
              >
                {item.action}
              </h4>

              <p
                style={{
                  margin: 0,
                }}
              >
                {item.rationale}
              </p>
            </div>
          ))}


          {performance.data_quality_notes
            ?.length > 0 && (
            <Accordion title="Data quality notes">
              <ul>
                {performance.data_quality_notes.map(
                  (note, index) => (
                    <li key={index}>
                      {note}
                    </li>
                  )
                )}
              </ul>
            </Accordion>
          )}
        </section>
      )}
    </main>
  );
}


export default App;