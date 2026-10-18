export const CATEGORIES = [
  {
    name: "Network/Connectivity",
    subtopics: [
      "no signal indoors",
      "slow mobile data",
      "call drops",
      "5G not showing",
      "broadband outage",
      "high latency/gaming lag",
    ],
  },
  {
    name: "Billing",
    subtopics: [
      "duplicate charge",
      "unexpected roaming charge",
      "wrong plan billed",
      "refund not received",
      "late fee dispute",
      "autopay failure",
    ],
  },
  {
    name: "Service Activation",
    subtopics: [
      "new SIM not activated",
      "eSIM QR not working",
      "broadband installation delay",
      "VoLTE not enabled",
      "OTT add-on not active",
      "international roaming activation",
    ],
  },
  {
    name: "SIM & Porting",
    subtopics: [
      "port-in stuck",
      "SIM card damaged",
      "SIM swap request",
      "port-out UPC code issue",
      "number blocked after port",
      "lost SIM",
    ],
  },
  {
    name: "Roaming",
    subtopics: [
      "no network abroad",
      "roaming pack not applied",
      "data not working abroad",
      "high roaming bill",
      "incoming calls not received abroad",
      "roaming SMS OTP not received",
    ],
  },
  {
    name: "Device/Handset",
    subtopics: [
      "phone not detecting SIM",
      "APN settings wrong",
      "hotspot not working",
      "VoWiFi not working",
      "router/ONT red light",
      "device locked to network",
    ],
  },
  {
    name: "Plan Change",
    subtopics: [
      "upgrade not reflected",
      "downgrade request blocked",
      "benefits missing after change",
      "family plan member add",
      "prepaid to postpaid migration",
      "data rollover missing",
    ],
  },
  {
    name: "Complaint/Escalation",
    subtopics: [
      "repeated unresolved issue",
      "rude agent experience",
      "technician no-show",
      "compensation request",
      "service closure request",
      "regulator complaint threat",
    ],
  },
] as const;

export type Category = (typeof CATEGORIES)[number]["name"];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name) as [Category, ...Category[]];
