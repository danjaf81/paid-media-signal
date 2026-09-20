import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = 3001;


// ---------------------------------------------
// HELPERS
// ---------------------------------------------

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let raw = String(value)
  .trim()
  .replace(/[^\d,.\-]/g, "");

  if (!raw) return 0;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  // Caso europeo: 11.082,22
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      // Caso internazionale: 11,082.22
      raw = raw.replace(/,/g, "");
    }
  }

  // Caso: 136,50
  else if (hasComma) {
    const parts = raw.split(",");

    if (
      parts.length === 2 &&
      parts[1].length <= 2
    ) {
      raw = raw.replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  }

  // Caso ambiguo con punto:
  // 19.845 può essere migliaia
  else if (hasDot) {
    const parts = raw.split(".");

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {
      raw = raw.replace(".", "");
    }
  }

  const number = Number(raw);

  return Number.isFinite(number)
    ? number
    : 0;
}


function divide(a, b, multiplier = 1) {
  if (!b) return 0;
  return (a / b) * multiplier;
}

function median(values) {
  const clean = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!clean.length) return 0;

  const middle = Math.floor(clean.length / 2);

  if (clean.length % 2) {
    return clean[middle];
  }

  return (clean[middle - 1] + clean[middle]) / 2;
}


// ---------------------------------------------
// KPI CALCULATION
// ---------------------------------------------

function calculateMetrics(campaign) {
  const spend = safeNumber(campaign.spend);
  const impressions = safeNumber(campaign.impressions);
  const clicks = safeNumber(campaign.clicks);
  const conversions = safeNumber(campaign.conversions);
  const conversionValue = safeNumber(campaign.conversion_value);
  const reach = safeNumber(campaign.reach);

  return {
    ...campaign,

    spend,
    impressions,
    clicks,
    conversions,
    conversion_value: conversionValue,
    reach,

    ctr: divide(clicks, impressions, 100),
    cpc: divide(spend, clicks),
    cpm: divide(spend, impressions, 1000),
    cvr: divide(conversions, clicks, 100),
    cpa: divide(spend, conversions),
    roas: divide(conversionValue, spend),

    frequency:
      reach > 0
        ? divide(impressions, reach)
        : null,
  };
}


// ---------------------------------------------
// ACCOUNT BENCHMARKS
// ---------------------------------------------

function calculateBenchmarks(campaigns) {
  return {
    spend: median(campaigns.map((c) => c.spend)),
    conversions: median(campaigns.map((c) => c.conversions)),
    ctr: median(campaigns.map((c) => c.ctr)),
    cvr: median(campaigns.map((c) => c.cvr)),
    cpa: median(
      campaigns
        .filter((c) => c.conversions > 0)
        .map((c) => c.cpa)
    ),
    roas: median(
      campaigns
        .filter((c) => c.spend > 0)
        .map((c) => c.roas)
    ),
  };
}


// ---------------------------------------------
// SIGNAL DETECTION
// ---------------------------------------------

function analyzeCampaign(campaign, benchmarks) {
  const signals = [];

  const strongRoas =
    benchmarks.roas > 0 &&
    campaign.roas >= benchmarks.roas * 1.2;

  const efficientCPA =
    campaign.conversions > 0 &&
    benchmarks.cpa > 0 &&
    campaign.cpa <= benchmarks.cpa * 0.8;

  const goodVolume =
    campaign.conversions >= benchmarks.conversions;

  const highCtr =
    benchmarks.ctr > 0 &&
    campaign.ctr >= benchmarks.ctr * 1.2;

  const weakCvr =
    benchmarks.cvr > 0 &&
    campaign.cvr <= benchmarks.cvr * 0.8;

  const highSpend =
    benchmarks.spend > 0 &&
    campaign.spend >= benchmarks.spend * 1.2;

  const weakRoas =
    benchmarks.roas > 0 &&
    campaign.roas <= benchmarks.roas * 0.8;

  const highFrequency =
    campaign.frequency !== null &&
    campaign.frequency >= 3;

  if (strongRoas) {
    signals.push("ROAS_ABOVE_ACCOUNT");
  }

  if (efficientCPA) {
    signals.push("CPA_BELOW_ACCOUNT");
  }

  if (highCtr && weakCvr) {
    signals.push("HIGH_CTR_LOW_CVR");
  }

  if (highSpend && weakRoas) {
    signals.push("HIGH_SPEND_LOW_ROAS");
  }

  if (highFrequency) {
    signals.push("HIGH_FREQUENCY");
  }


  // -------------------------------------------
  // ACTION STATUS
  // -------------------------------------------

  let status = "KEEP";

  if (
    strongRoas &&
    efficientCPA &&
    goodVolume
  ) {
    status = "SCALE";
  } else if (
    highSpend &&
    weakRoas
  ) {
    status = "REVIEW";
  } else if (
    highCtr &&
    weakCvr
  ) {
    status = "OPTIMIZE";
  } else if (
    highFrequency
  ) {
    status = "WATCH";
  }


  return {
    ...campaign,
    signals,
    status,
  };
}


// ---------------------------------------------
// AI INTERPRETATION
// ---------------------------------------------

async function generateAiSummary(campaigns, benchmarks) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: `
You are a paid media analyst.

You receive campaign metrics and deterministic performance signals
from Google Ads and Meta Ads.

Do not recalculate metrics.

Interpret the supplied signals and produce a concise executive analysis.

Prioritize:
- campaigns worth scaling
- campaigns wasting budget
- conversion problems
- possible creative fatigue
- the most important next actions

Do not invent benchmarks or information that is not provided.
`,
      },
      {
        role: "user",
        content: JSON.stringify({
          benchmarks,
          campaigns,
        }),
      },
    ],

    response_format: {
      type: "json_schema",

      json_schema: {
        name: "paid_media_analysis",
        strict: true,

        schema: {
          type: "object",

          properties: {
            summary: {
              type: "string",
            },

            priorities: {
              type: "array",

              items: {
                type: "object",

                properties: {
                  campaign_name: {
                    type: "string",
                  },

                  action: {
                    type: "string",
                  },

                  reason: {
                    type: "string",
                  },
                },

                required: [
                  "campaign_name",
                  "action",
                  "reason",
                ],

                additionalProperties: false,
              },
            },
          },

          required: [
            "summary",
            "priorities",
          ],

          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(
    response.choices[0].message.content
  );
}


// --------------------------------------------------
// DETERMINISTIC DATA PROFILER
// --------------------------------------------------

function normalizeFieldName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[%€$£]/g, "")
    .replace(/[()./:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_CATALOG = [

  // ------------------------------------------------
  // CORE PERFORMANCE METRICS
  // ------------------------------------------------

  {
    canonical: "spend",
    category: "metric",
    aliases: [
      "costo",
      "importo speso eur",
      "importo speso",
      "spend",
    ],
  },

  {
    canonical: "impressions",
    category: "metric",
    aliases: [
      "impression",
      "impressioni",
      "impressions",
    ],
  },

  {
    canonical: "reach",
    category: "metric",
    aliases: [
      "copertura",
      "reach",
    ],
  },

  {
    canonical: "clicks",
    category: "metric",
    aliases: [
      "clic",
      "clicks",
    ],
  },

  {
    canonical: "ctr",
    category: "metric",
    aliases: [
      "ctr",
    ],
  },

  {
    canonical: "link_ctr",
    category: "metric",
    aliases: [
      "ctr tasso di clic sul link",
      "link ctr",
    ],
  },

  {
    canonical: "cpc",
    category: "metric",
    aliases: [
      "cpc medio",
      "average cpc",
      "cpc",
    ],
  },

  {
    canonical: "conversions",
    category: "metric",
    aliases: [
      "conversioni",
      "conversions",
    ],
  },

  {
    canonical: "conversion_value",
    category: "metric",
    aliases: [
      "valore conv",
      "valore conversioni",
      "conversion value",
      "valore risultati",
    ],
  },

  {
    canonical: "roas",
    category: "metric",
    aliases: [
      "valore conv costo",
      "roas risultati",
      "purchase roas",
      "roas",
    ],
  },

  {
    canonical: "cost_per_result",
    category: "metric",
    aliases: [
      "costo per risultati",
      "cost per result",
      "costo conv",
    ],
  },

  {
    canonical: "outcome_value",
    category: "metric",
    aliases: [
      "risultati",
    ],
  },

  {
    canonical: "post_interactions",
    category: "metric",
    aliases: [
      "interazioni con il post",
      "post interactions",
    ],
  },

  {
    canonical: "unique_users",
    category: "metric",
    aliases: [
      "utenti unici",
      "unique users",
    ],
  },


  // ------------------------------------------------
  // FUNNEL METRICS
  // ------------------------------------------------

  {
    canonical: "add_to_cart",
    category: "funnel_metric",
    aliases: [
      "aggiunta al carrello",
      "add to cart",
    ],
  },

  {
    canonical: "checkout",
    category: "funnel_metric",
    aliases: [
      "avvio del pagamento",
      "checkout",
      "initiate checkout",
    ],
  },


  // ------------------------------------------------
  // OUTCOME DESCRIPTORS
  // ------------------------------------------------

  {
    canonical: "outcome_type",
    category: "outcome",
    aliases: [
      "indicatore di risultato",
      "result indicator",
    ],
  },

  {
    canonical: "outcome_value_type",
    category: "outcome",
    aliases: [
      "indicatore di valore del risultato",
    ],
  },


  // ------------------------------------------------
  // DIMENSIONS
  // ------------------------------------------------

  {
    canonical: "campaign_name",
    category: "dimension",
    aliases: [
      "campagna",
      "nome campagna",
      "nome della campagna",
      "campaign",
      "campaign name",
    ],
  },

  {
    canonical: "ad_set_name",
    category: "dimension",
    aliases: [
      "nome del gruppo di inserzioni",
      "ad set name",
    ],
  },

  {
    canonical: "ad_name",
    category: "dimension",
    aliases: [
      "nome dell inserzione",
      "ad name",
    ],
  },

  {
    canonical: "device",
    category: "dimension",
    aliases: [
      "dispositivo",
      "device",
    ],
  },

  {
    canonical: "age",
    category: "dimension",
    aliases: [
      "fascia d eta",
      "age",
      "age range",
    ],
  },

  {
    canonical: "gender",
    category: "dimension",
    aliases: [
      "genere",
      "gender",
    ],
  },

  {
    canonical: "day",
    category: "dimension",
    aliases: [
      "giorno",
      "day",
    ],
  },

  {
    canonical: "hour",
    category: "dimension",
    aliases: [
      "ora",
      "ora di inizio",
      "hour",
    ],
  },

  {
    canonical: "keyword",
    category: "dimension",
    aliases: [
      "parola chiave per la rete di ricerca",
      "keyword",
    ],
  },

  {
    canonical: "match_type",
    category: "dimension",
    aliases: [
      "tipo di corrispondenza",
      "match type",
    ],
  },

  {
    canonical: "campaign_type",
    category: "dimension",
    aliases: [
      "tipo di campagna",
      "campaign type",
    ],
  },


  // ------------------------------------------------
  // SETTINGS / CONFIGURATION
  // ------------------------------------------------

  {
    canonical: "budget",
    category: "setting",
    aliases: [
      "budget",
      "budget del gruppo di inserzioni",
    ],
  },

  {
    canonical: "budget_name",
    category: "setting",
    aliases: [
      "nome budget",
    ],
  },

  {
    canonical: "budget_type",
    category: "setting",
    aliases: [
      "tipo di budget",
      "tipo di budget del gruppo di inserzioni",
    ],
  },

  {
    canonical: "currency",
    category: "setting",
    aliases: [
      "codice valuta",
      "currency",
    ],
  },

  {
    canonical: "campaign_status",
    category: "setting",
    aliases: [
      "stato",
      "stato della campagna",
      "pubblicazione della campagna",
      "pubblicazione dell inserzione",
    ],
  },

  {
    canonical: "status_reason",
    category: "setting",
    aliases: [
      "motivi dello stato",
    ],
  },

  {
    canonical: "bid_strategy",
    category: "setting",
    aliases: [
      "strategia di offerta",
      "tipo di offerta",
      "bid strategy",
    ],
  },

  {
    canonical: "attribution_setting",
    category: "setting",
    aliases: [
      "impostazione di attribuzione",
      "attribution setting",
    ],
  },

  {
    canonical: "target_roas",
    category: "setting",
    aliases: [
      "roas target",
      "target roas",
    ],
  },


  // ------------------------------------------------
  // PLATFORM DIAGNOSTICS
  // ------------------------------------------------

  {
    canonical: "optimization_score",
    category: "diagnostic",
    aliases: [
      "punteggio di ottimizzazione",
      "optimization score",
    ],
  },

  {
    canonical: "lost_impression_share_rank",
    category: "diagnostic",
    aliases: [
      "qi persa rete di ricerca ranking",
    ],
  },

  {
    canonical: "lost_impression_share_budget",
    category: "diagnostic",
    aliases: [
      "qi persa rete di ricerca budget",
    ],
  },

  {
    canonical: "ga4_engagement_rate",
    category: "diagnostic",
    aliases: [
      "sessioni con coinvolgimento ga4",
    ],
  },

  {
    canonical: "quality_ranking",
    category: "diagnostic",
    aliases: [
      "valutazione della qualita",
    ],
  },

  {
    canonical: "engagement_ranking",
    category: "diagnostic",
    aliases: [
      "valutazione del tasso di coinvolgimento",
    ],
  },

  {
    canonical: "conversion_ranking",
    category: "diagnostic",
    aliases: [
      "classificazione tasso di conversione",
    ],
  },
];

function buildDeterministicProfile(files) {
  const recognized = [];
  const unknownFields = [];

  for (const file of files) {
    for (const originalField of file.columns || []) {
      const normalizedField =
        normalizeFieldName(originalField);

      const rule = FIELD_CATALOG.find((item) =>
        item.aliases.includes(normalizedField)
      );

      if (rule) {
        recognized.push({
          filename: file.filename,
          source_field: originalField,
          canonical: rule.canonical,
          category: rule.category,
        });
      } else {
        unknownFields.push({
          filename: file.filename,
          source_field: originalField,
        });
      }
    }
  }

  const metricNames = new Set(
    recognized
      .filter((item) => item.category === "metric")
      .map((item) => item.canonical)
  );

  const derivable = [];

  if (
    metricNames.has("impressions") &&
    metricNames.has("reach")
  ) {
    derivable.push("frequency");
  }

  if (
    metricNames.has("spend") &&
    metricNames.has("clicks")
  ) {
    derivable.push("cpc");
  }

  if (
    metricNames.has("clicks") &&
    metricNames.has("impressions")
  ) {
    derivable.push("ctr");
  }

  if (
    metricNames.has("spend") &&
    metricNames.has("impressions")
  ) {
    derivable.push("cpm");
  }

  if (
    metricNames.has("spend") &&
    metricNames.has("conversion_value")
  ) {
    derivable.push("roas");
  }

  return {
    recognized_fields: recognized,
    derivable_metrics: [...new Set(derivable)],
    unknown_fields: unknownFields,
  };
}


function normalizePerformanceRow(
  row,
  filename,
  profile
) {
  const mappings =
    profile.recognized_fields.filter(
      (item) => item.filename === filename
    );

  const normalized = {};

  for (const mapping of mappings) {
    const rawValue = row[mapping.source_field];

    if (
      rawValue === undefined ||
      rawValue === null ||
      String(rawValue).trim() === ""
    ) {
      continue;
    }

    // Se più colonne mappano sullo stesso campo canonico,
    // manteniamo il primo valore non vuoto trovato.
    if (
      normalized[mapping.canonical] !== undefined
    ) {
      continue;
    }

    if (mapping.canonical === "target_roas") {
  normalized[mapping.canonical] =
    safeNumber(rawValue) / 100;
} else if (mapping.canonical === "budget") {
  normalized[mapping.canonical] =
    safeNumber(rawValue);
} else if (
  mapping.category === "metric" ||
  mapping.category === "funnel_metric" ||
  mapping.category === "diagnostic"
) {
  normalized[mapping.canonical] =
    safeNumber(rawValue);
} else {
  normalized[mapping.canonical] =
    String(rawValue).trim();
}
  }

  return normalized;
}

function isSummaryRow(row) {
  return Object.values(row).some((value) => {
    const text = String(value || "")
      .trim()
      .toLowerCase();

    return (
      text.startsWith("totale:") ||
      text.startsWith("total:")
    );
  });
}

function buildAuthoritativeAudit(profile) {
  function collectByCategory(category) {
    const grouped = new Map();

    for (const item of profile.recognized_fields) {
      if (item.category !== category) continue;

      if (!grouped.has(item.canonical)) {
        grouped.set(item.canonical, new Set());
      }

      grouped
        .get(item.canonical)
        .add(item.source_field);
    }

    return [...grouped.entries()].map(
      ([canonical, fields]) => ({
        canonical,
        source_fields: [...fields],
      })
    );
  }

  const normalizedMetrics =
    collectByCategory("metric").map((item) => ({
      metric: item.canonical,
      source_fields: item.source_fields,
    }));

  const funnelMetrics =
    collectByCategory("funnel_metric");

  const dimensions =
    collectByCategory("dimension");

  const settings =
    collectByCategory("setting");

  const diagnostics =
    collectByCategory("diagnostic");

  const outcomes =
    collectByCategory("outcome");
    const availableMetricNames = new Set(
    profile.recognized_fields
      .filter((item) => item.category === "metric")
      .map((item) => item.canonical)
  );

  const availableOrDerivable = new Set([
    ...availableMetricNames,
    ...profile.derivable_metrics,
  ]);

  const coreMetricRequirements = [
    {
      label: "spend",
      satisfiedBy: ["spend"],
    },
    {
      label: "impressions",
      satisfiedBy: ["impressions"],
    },
    {
      label: "clicks",
      satisfiedBy: ["clicks"],
    },
    {
      label: "conversions/outcomes",
      satisfiedBy: [
        "conversions",
        "outcome_value",
      ],
    },
    {
      label: "conversion_value",
      satisfiedBy: ["conversion_value"],
    },
    {
      label: "roas",
      satisfiedBy: ["roas"],
    },
  ];

  const missingCoreMetrics =
    coreMetricRequirements
      .filter(
        (requirement) =>
          !requirement.satisfiedBy.some((metric) =>
            availableOrDerivable.has(metric)
          )
      )
      .map((requirement) => requirement.label);

  return {
    missing_core_metrics: missingCoreMetrics,
    
    normalized_metrics: normalizedMetrics,

    funnel_metrics_available: funnelMetrics,

    dimensions_available: dimensions.map(
      (item) => item.canonical
    ),

    settings_available: settings,

    diagnostics_available: diagnostics.map(
      (item) => item.canonical
    ),

    outcome_fields_available: outcomes,
  };
}

async function auditDataSources(files, primaryKpi, targetValue) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const deterministicProfile =
  buildDeterministicProfile(files);

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: `
You are a senior paid media data analyst.

You receive metadata, column names and sample rows from one or more CSV exports.

Your task is NOT to evaluate campaign performance yet.

Your task is to understand the uploaded data and determine what kind of analysis can realistically be performed.

Files may come from:
- Google Ads
- Meta Ads
- other paid media platforms

Column names may be localized in Italian or other languages.

IMPORTANT SEMANTIC RULES:

Recognize equivalent concepts even when labels differ.

Examples:

"Importo speso", "Costo", "Spend" → spend

"Copertura", "Reach" → reach

"ROAS risultati", "Valore conv./costo", "Purchase ROAS" → roas

"Clic", "Clicks" → clicks

"Impression", "Impressioni" → impressions

"Costo per risultati", "Costo/conv." → cost_per_result

Do NOT report a metric as missing if an equivalent localized field is already available.

For Meta Ads, interpret "Risultati" together with "Indicatore di risultato".
Results may represent purchases, leads, profile visits or other outcomes.

Distinguish clearly between:

1. CORE METRICS
   spend, impressions, clicks, CTR, conversions/outcomes, CPA/cost per result, conversion value, ROAS

2. DIMENSIONS / BREAKDOWNS
   device, age, gender, day, hour, placement, keyword, search term, audience

3. CREATIVE / PLATFORM DIAGNOSTICS
   quality ranking, engagement ranking, conversion ranking, optimization score, impression share, lost impression share

4. JOIN KEYS
   fields that can realistically connect multiple files, such as campaign name, campaign ID, ad set name/ID or ad name/ID

Do not classify ordinary breakdown dimensions such as age, gender or device as join keys unless they genuinely connect two reports.

Recognize the hierarchy when possible:

Google Ads:
Campaign → Ad Group → Ad / Keyword / Search Term

Meta Ads:
Campaign → Ad Set → Ad

If different campaign objectives or outcome types are present, identify them separately.

Evaluate all uploaded files together.
Information missing in one file may be available in another.

When recommending additional data, be specific about what export or metric would materially improve the analysis.

PRIMARY KPI ANALYSIS:

The user provides a primary KPI and optionally a target value.

You must evaluate that KPI explicitly.

For the selected KPI, determine one of these statuses:

- found: the KPI exists directly in the uploaded data
- derivable: the KPI is not directly present but can be calculated from available fields
- ambiguous: there is a possible mapping, but it is not reliable enough
- missing: the KPI cannot be found or derived

Always explain:
- which source fields support the KPI
- whether the KPI is directly available or derived
- what is missing, if anything
- your confidence in the mapping

Do not map semantically different metrics just because they look similar.

Examples:
- "Interazioni con il post" is NOT equivalent to link clicks
- "Valore conv." is conversion value, NOT number of conversions
- "Valore conv./costo" is ROAS
- "ROAS risultati" is ROAS
- reach and impressions are different metrics
- CTR does not imply click count unless impressions are also available

If a target value is provided, include it in the evaluation but do not judge performance yet.
This stage is only about data readiness.

DETERMINISTIC PROFILE:

A deterministic profiler has already analyzed known advertising fields.

Treat deterministic_profile.recognized_fields as authoritative for known mappings.

Do not contradict these mappings.

Do not invent fields that are not present in the uploaded data.

Use unknown_fields only when semantic interpretation is necessary.

Use derivable_metrics to identify metrics that can be calculated from existing data.

If the deterministic profile says:
- "Valore conv." = conversion_value, do not classify it as conversions
- "Interazioni con il post" = post_interactions, do not classify it as clicks

For unknown or ambiguous fields, use your judgment and report uncertainty explicitly.

Do not invent data.
`,
      },

      {
        role: "user",
        content: JSON.stringify({
  	  primary_kpi: primaryKpi,
  	  target_value: targetValue,

  	  deterministic_profile: deterministicProfile,

	  files,
	}),
      },
    ],

    response_format: {
      type: "json_schema",

      json_schema: {
        name: "paid_media_data_audit_v2",
        strict: true,

        schema: {
          type: "object",

          properties: {
  platform: {
    type: "string",
  },

  files_detected: {
    type: "array",
    items: {
      type: "object",
      properties: {
        filename: {
          type: "string",
        },
        report_type: {
          type: "string",
        },
        level: {
          type: "string",
        },
        relevance: {
          type: "string",
        },
      },
      required: [
        "filename",
        "report_type",
        "level",
        "relevance",
      ],
      additionalProperties: false,
    },
  },

  normalized_metrics: {
    type: "array",
    items: {
      type: "object",
      properties: {
        metric: {
          type: "string",
        },
        source_fields: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: [
        "metric",
        "source_fields",
      ],
      additionalProperties: false,
    },
  },

  primary_kpi_analysis: {
    type: "object",
    properties: {
      kpi: {
        type: "string",
      },

      status: {
        type: "string",
        enum: [
          "found",
          "derivable",
          "ambiguous",
          "missing",
        ],
      },

      source_fields: {
        type: "array",
        items: {
          type: "string",
        },
      },

      confidence: {
        type: "string",
        enum: [
          "low",
          "medium",
          "high",
        ],
      },

      missing_requirements: {
        type: "array",
        items: {
          type: "string",
        },
      },

      target_value: {
        type: ["number", "null"],
      },

      explanation: {
        type: "string",
      },
    },

    required: [
      "kpi",
      "status",
      "source_fields",
      "confidence",
      "missing_requirements",
      "target_value",
      "explanation",
    ],

    additionalProperties: false,
  },

  dimensions_available: {
    type: "array",
    items: {
      type: "string",
    },
  },

  diagnostics_available: {
    type: "array",
    items: {
      type: "string",
    },
  },

  outcomes_detected: {
    type: "array",
    items: {
      type: "string",
    },
  },

  hierarchy_detected: {
    type: "array",
    items: {
      type: "string",
    },
  },

  possible_join_keys: {
    type: "array",
    items: {
      type: "string",
    },
  },

  missing_core_metrics: {
    type: "array",
    items: {
      type: "string",
    },
  },

  optional_breakdowns_missing: {
    type: "array",
    items: {
      type: "string",
    },
  },

  readiness: {
    type: "array",
    items: {
      type: "object",
      properties: {
        area: {
          type: "string",
        },

        status: {
          type: "string",
          enum: [
            "limited",
            "partial",
            "good",
            "excellent",
          ],
        },

        reason: {
          type: "string",
        },
      },

      required: [
        "area",
        "status",
        "reason",
      ],

      additionalProperties: false,
    },
  },

  recommended_additional_data: {
    type: "array",
    items: {
      type: "string",
    },
  },

  summary: {
    type: "string",
  },
},

required: [
  "platform",
  "files_detected",
  "normalized_metrics",
  "primary_kpi_analysis",
  "dimensions_available",
  "diagnostics_available",
  "outcomes_detected",
  "hierarchy_detected",
  "possible_join_keys",
  "missing_core_metrics",
  "optional_breakdowns_missing",
  "readiness",
  "recommended_additional_data",
  "summary",
],

          additionalProperties: false,
        },
      },
    },
  });

  const aiAudit = JSON.parse(
  response.choices[0].message.content
);

const authoritativeAudit =
  buildAuthoritativeAudit(
    deterministicProfile
  );

// Sezioni affidate al codice deterministico
aiAudit.normalized_metrics =
  authoritativeAudit.normalized_metrics;

aiAudit.dimensions_available =
  authoritativeAudit.dimensions_available;

aiAudit.diagnostics_available =
  authoritativeAudit.diagnostics_available;

// Nuove sezioni tassonomiche
aiAudit.funnel_metrics_available =
  authoritativeAudit.funnel_metrics_available;

aiAudit.settings_available =
  authoritativeAudit.settings_available;

aiAudit.outcome_fields_available =
  authoritativeAudit.outcome_fields_available;

aiAudit.missing_core_metrics =
  authoritativeAudit.missing_core_metrics;

const missingCoreCount =
  authoritativeAudit.missing_core_metrics.length;

let coreStatus = "excellent";

if (missingCoreCount >= 4) {
  coreStatus = "limited";
} else if (missingCoreCount >= 2) {
  coreStatus = "partial";
} else if (missingCoreCount === 1) {
  coreStatus = "good";
}

const dimensionsCount =
  authoritativeAudit.dimensions_available.length;

let dimensionsStatus = "limited";

if (dimensionsCount >= 6) {
  dimensionsStatus = "excellent";
} else if (dimensionsCount >= 3) {
  dimensionsStatus = "good";
} else if (dimensionsCount >= 1) {
  dimensionsStatus = "partial";
}

const diagnosticsCount =
  authoritativeAudit.diagnostics_available.length;

let diagnosticsStatus = "limited";

if (diagnosticsCount >= 4) {
  diagnosticsStatus = "excellent";
} else if (diagnosticsCount >= 2) {
  diagnosticsStatus = "good";
} else if (diagnosticsCount === 1) {
  diagnosticsStatus = "partial";
}

const kpiStatusMap = {
  found: "excellent",
  derivable: "good",
  ambiguous: "partial",
  missing: "limited",
};

const hasOutcomeDescriptor =
  authoritativeAudit.outcome_fields_available.length > 0;

const hasDirectConversions =
  authoritativeAudit.normalized_metrics.some(
    (item) => item.metric === "conversions"
  );

const hasGenericOutcomeValue =
  authoritativeAudit.normalized_metrics.some(
    (item) => item.metric === "outcome_value"
  );

// L'AI può interpretare semanticamente gli outcome
// solo quando esiste un campo che ne descrive il tipo
// (es. Meta "Indicatore di risultato").
if (!hasOutcomeDescriptor) {
  if (hasDirectConversions) {
    aiAudit.outcomes_detected = ["conversions"];
  } else if (hasGenericOutcomeValue) {
    aiAudit.outcomes_detected = ["outcomes"];
  } else {
    aiAudit.outcomes_detected = [];
  }
}

aiAudit.readiness = [
  {
    area: "Primary KPI",
    status:
      kpiStatusMap[
        aiAudit.primary_kpi_analysis.status
      ] || "limited",
    reason:
      aiAudit.primary_kpi_analysis.explanation,
  },

  {
    area: "Core Metrics",
    status: coreStatus,
    reason:
      missingCoreCount === 0
        ? "All core metric groups are available."
        : `Missing: ${authoritativeAudit.missing_core_metrics.join(
            ", "
          )}.`,
  },

  {
    area: "Dimensions",
    status: dimensionsStatus,
    reason: `${dimensionsCount} recognized analysis dimensions available.`,
  },

  {
    area: "Diagnostics",
    status: diagnosticsStatus,
    reason: `${diagnosticsCount} recognized diagnostic fields available.`,
  },
];

return aiAudit;

}

// ---------------------------------------------
// API
// ---------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Paid Media Signal Analyzer",
  });
});


app.post("/api/audit", async (req, res) => {
  try {
    const {
  	files,
  	primary_kpi,
  	target_value,
	} = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: "No files provided.",
      });
    }

    if (files.length > 10) {
      return res.status(400).json({
        error: "Maximum 10 CSV files allowed.",
      });
    }

    const audit = await auditDataSources(
  	files,
  	primary_kpi,
  	target_value
	);

    res.json(audit);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Data audit failed.",
    });
  }
});


app.post("/api/normalize", (req, res) => {
  try {
    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: "No files provided.",
      });
    }

    const profile =
      buildDeterministicProfile(files);

    const normalizedFiles = files.map((file) => {
      const rows = (file.data_rows || [])
        .map((row) =>
          normalizePerformanceRow(
            row,
            file.filename,
            profile
          )
        )
        .filter(
          (row) =>
            Object.keys(row).length > 0
        )
        .filter(
          (row) => !isSummaryRow(row)
        );

      return {
        filename: file.filename,
        original_rows:
          file.data_rows?.length || 0,
        normalized_rows: rows.length,
        rows,
      };
    });

    res.json({
      files: normalizedFiles,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Normalization failed.",
    });
  }
});


app.post("/api/analyze", async (req, res) => {
  try {
    const { campaigns } = req.body;

    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return res.status(400).json({
        error: "No campaign data provided.",
      });
    }

    const campaignsWithMetrics =
      campaigns.map(calculateMetrics);

    const benchmarks =
      calculateBenchmarks(campaignsWithMetrics);

    const analyzedCampaigns =
      campaignsWithMetrics.map((campaign) =>
        analyzeCampaign(campaign, benchmarks)
      );

    const ai =
      await generateAiSummary(
        analyzedCampaigns,
        benchmarks
      );

    res.json({
      benchmarks,
      campaigns: analyzedCampaigns,
      ai,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Analysis failed.",
    });
  }
});


// ---------------------------------------------
// START
// ---------------------------------------------

app.listen(PORT, () => {
  console.log(
    `Paid Media Signal Analyzer API running on http://localhost:${PORT}`
  );
});