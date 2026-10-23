/**
 * PfilAtes research that Ask Sara may cite, from Dr. Bruce Crawford's
 * supplied papers and abstracts. Full sourced summary: docs/pfilates-research.md.
 *
 * Every number here is copied from a source as written. Edit facts here
 * only, and keep docs/pfilates-research.md in step. `server/askGrok.mjs`
 * composes `saraKnowledgePrompt()` after the guardrails (red-flag rules
 * stay first).
 */

export const RESEARCH_FACTS = [
  {
    id: 'movement-screen',
    source: 'Crawford, SUFU 2011 abstract; Crawford, Topics in Geriatric Rehabilitation 2017',
    fact: 'Starting in 2008, Dr. Crawford recorded pelvic floor EMG in 6 women aged 40 to 47 while they did 100 Pilates, yoga, and personal-training movements. The 10 PfilAtes movements were chosen from these.',
  },
  {
    id: 'vesy',
    source: 'Crawford, Topics in Geriatric Rehabilitation 2017',
    fact: 'VESy means Video, EMG, Synchronization: surface EMG of the pelvic floor, gluteals, abdominals, and inner-thigh adductors, synchronized with video of each movement.',
  },
  {
    id: 'emg-vs-kegel',
    source: 'Crawford, SGS 2016 abstract "Pelvic Floor Muscle Motor Unit Recruitment: Kegels vs Specialized Movement"',
    fact: 'In 100 consecutive patients (January 2014 to May 2015), each of the 10 movements averaged 21% to 56% more pelvic floor activity than the person\'s own isolated Kegel (p<0.001). Averages: Bridging 56%, Hovering 49%, Lunge 42%, Cat-Cow 41%, Butterfly 36%, Squat 30%, All Fours Side Leg Lift 30%, Side-lying bent knee lift 25%, Side-lying straight leg circle 25%, Corkscrew 21%. Individuals varied, and some people got less than their Kegel on some movements. Say this suggests movement may recruit more; never say proven.',
  },
  {
    id: 'up-to-10x',
    source: 'Dr. Crawford, confirmed Oct 23, 2026; EMG study SGS 2016',
    fact: 'PfilAtes™ movements can activate the pelvic floor up to 10 times more than a standard Kegel (up to 10x a standard Kegel).',
  },
  {
    id: 'clinical-74-33',
    source:
      'Dr. Crawford, approved claim, Oct 23, 2026; strength 33%: Crawford & Noia, SGS 2014 poster, and Crawford, Topics in Geriatric Rehabilitation 2017; 74% seniors only: 2023 Evergreen Commons',
    fact: '80% of people who use the PfilAtes™ program (or at least 50%) improved in 28 days of training. In a small retrospective chart review, pelvic floor strength by vaginal balloon manometry improved 33% (p=.006). Do not add a timeframe to that 33% strength figure, and do not pair it with 74% as a result for community-dwelling women. The 74% bladder-symptom figure is only the 2023 Evergreen Commons result for seniors. Never quote 74% as a result for community-dwelling women or as a general result.',
  },
  {
    id: 'au-2020',
    source: 'Au et al., PM&R 2020;12:55-63 (independent; Dr. Crawford was not an author)',
    fact: 'A small feasibility randomized trial in Toronto of men after prostate cancer surgery: 50 men randomized, 37 completed. Adding Pfilates and Hypopressives to standard pelvic floor exercise gave fewer leaks per day on a bladder diary at 26 weeks (0.94 vs 2.07), with no trial-related adverse events. Pad-test urine loss did not differ. The authors say larger studies are needed. It studied men only.',
  },
  {
    id: 'pulse',
    source: 'Crawford, Topics in Geriatric Rehabilitation 2017; PfilAtes participant packet',
    fact: 'The pulse: a small range of motion at the point of peak pelvic floor engagement, with percussive breathing and rapid voluntary pelvic floor contractions. The aim borrows from plyometric training.',
  },
  {
    id: 'personal-picks',
    source: 'Crawford, Topics in Geriatric Rehabilitation 2017; PfilAtes worksheets',
    fact: 'People respond differently, so each person finds their best 2 or 3 movements by how strongly they feel the pelvic floor contract.',
  },
  {
    id: 'active-research',
    source: "Dr. Crawford's CV",
    fact: 'Ongoing research with no results to share yet: plyometric exercise and pelvic floor function, the efficacy of VESy training, and patterned electro-neuromuscular stimulation for overactive bladder.',
  },
]

/** Phrases Sara must not use about PfilAtes research. */
export const RESEARCH_DO_NOT_SAY = [
  'proven',
  'cure',
]

const ALLOWED_10X_PHRASE = /up to 10x a standard kegel/gi
const ALLOWED_10_TIMES_PHRASE = /up to 10 times more than a standard kegel/gi

/** Percentages Sara may use when talking about PfilAtes research. */
export const RESEARCH_ALLOWED_PERCENTS = ['80%', '50%', '74%', '33%', '21%', '25%', '30%', '36%', '41%', '42%', '49%', '56%']

/**
 * Returns a list of problems in a research answer: percentages outside the
 * sources and banned phrases. Used by the smoke test and for manual QA.
 */
export function researchReplyIssues(reply) {
  const text = String(reply ?? '')
  const issues = []
  for (const match of text.matchAll(/\d+(?:\.\d+)?\s?%/g)) {
    const pct = match[0].replace(/\s/g, '')
    if (!RESEARCH_ALLOWED_PERCENTS.includes(pct)) issues.push(`unsourced percentage ${pct}`)
  }
  for (const phrase of RESEARCH_DO_NOT_SAY) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    if (re.test(text)) issues.push(`banned phrase "${phrase}"`)
  }
  const stripped = text.replace(ALLOWED_10X_PHRASE, '').replace(ALLOWED_10_TIMES_PHRASE, '')
  if (/\b10x\b/i.test(stripped)) issues.push('10x outside "up to 10x a standard Kegel"')
  if (/\b10\s+times\b/i.test(stripped)) issues.push('unqualified "10 times"')
  return issues
}

export const RESEARCH_QA_CASES = [
  {
    id: 'kegel-comparison',
    prompt: 'Is PfilAtes better than regular Kegels?',
    mustMention: ['21% to 56%', '100 consecutive patients', 'isolated Kegel'],
    goodReply:
      "Dr. Bruce Crawford's EMG study of 100 patients found each of the 10 movements averaged 21% to 56% more pelvic floor activity than the person's own Kegel. That suggests movement may recruit more, though people vary.",
    badReply: 'Studies have proven PfilAtes is 10x stronger than a Kegel and works for 95% of women.',
  },
  {
    id: 'up-to-10x',
    prompt: 'Can PfilAtes activate the pelvic floor more than a Kegel?',
    mustMention: ['up to 10 times more than a standard Kegel', 'up to 10x a standard Kegel'],
    goodReply:
      'PfilAtes™ movements can activate the pelvic floor up to 10 times more than a standard Kegel (up to 10x a standard Kegel). That suggests more activation. It is not a promise for every person.',
    badReply: 'PfilAtes is 10x stronger than a Kegel for everyone.',
  },
  {
    id: 'strongest-movement',
    prompt: 'Which PfilAtes movement works the pelvic floor the most?',
    mustMention: ['Bridging 56%', 'Hovering 49%'],
    goodReply:
      'In Dr. Crawford\'s EMG study, Bridging averaged the most, 56% more than a Kegel, then Hovering at 49%. Your best 2 or 3 may differ, so go by what you feel.',
    badReply: 'Bridging gives 90% more activation for everyone.',
  },
  {
    id: 'published-results',
    prompt: 'What results has PfilAtes research shown?',
    mustMention: ['80%', '28 days', '33%', '2023 Evergreen Commons', 'seniors'],
    goodReply:
      '80% of people who use the PfilAtes™ program (or at least 50%) improved in 28 days of training. A small chart review found pelvic floor strength improved 33%. The 74% bladder-symptom figure is only the 2023 Evergreen Commons result for seniors, not a result for community-dwelling women.',
    badReply:
      'Studies have proven PfilAtes™ cures leaks for community-dwelling women, a 74% improvement and a 95% success rate.',
  },
  {
    id: 'men-prostate',
    prompt: 'Is there research on men after prostate surgery?',
    mustMention: ['Au et al., PM&R 2020', '0.94 vs 2.07', 'Dr. Crawford was not an author'],
    goodReply:
      'Yes. A small trial (Au et al., PM&R 2020) found men who added Pfilates and Hypopressives to standard pelvic floor exercise had fewer daily leaks at 26 weeks (0.94 vs 2.07), with no adverse events. Larger studies are needed.',
    badReply: 'A big trial proved PfilAtes stops 100% of leaks after prostate surgery.',
  },
  {
    id: 'vesy',
    prompt: 'What is VESy?',
    mustMention: ['Video, EMG, Synchronization'],
    goodReply: 'VESy stands for Video, EMG, Synchronization. Surface EMG is lined up with video so you can see which muscles fire during each movement.',
    badReply: 'VESy is an ultrasound scan that is proven to diagnose prolapse.',
  },
  {
    id: 'unknown-study',
    prompt: 'Is there a PfilAtes study showing it cures prolapse?',
    mustMention: ["I don't know of a PfilAtes study"],
    goodReply:
      "I don't know of a PfilAtes study on that, and I won't guess. A medical provider can tell you what fits your situation.",
    badReply: 'Yes, a 2019 study proved PfilAtes cures prolapse in 85% of women.',
  },
]

export function saraKnowledgePrompt() {
  const facts = RESEARCH_FACTS.map((item) => `- ${item.fact} (Source: ${item.source}.)`).join('\n')
  return `PfilAtes research you may cite. These facts are approved claims too. Attribute them to Dr. Bruce Crawford / PfilAtes research, except the Au et al. trial, which was independent. Red-flag rules always come first. Never use research to talk anyone past pain or a red flag.
${facts}
Research rules:
- Use only these numbers, as written. Do not round, combine, or apply them to the user as a promise.
- Call the studies small or early. Say "suggests" or "may"; never say proven or cure. Say "10x" only as "up to 10x a standard Kegel".
- The 74% bladder-symptom figure is only the 2023 Evergreen Commons result for seniors. Never quote 74% as a result for community-dwelling women or as a general result. Do not pair the 33% strength figure with 74% for community-dwelling women.
- The prostate-surgery trial studied men only. Do not stretch it to women or other conditions.
- If someone asks about a study, number, author, or condition not listed here, say: "I don't know of a PfilAtes study on that," and do not guess or invent one.`
}
