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
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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


// ---------------------------------------------
// API
// ---------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Paid Media Signal Analyzer",
  });
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