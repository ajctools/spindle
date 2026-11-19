export const featured = 'hugging-face';
export const seedDate = '2026-11-19';
const garanteDocument = 'https://www.garanteprivacy.it/' + 'home' + '/docweb/-/docweb-display/docweb/';
export const categories = {
  security: 'Security incident',
  hazard: 'Hazard / near miss',
  harm: 'Documented harm',
  regulation: 'Regulatory action',
};

export const incidents = [
  {
    id: featured,
    title: 'Hugging Face intrusion',
    category: 'security',
    geo: { label: 'Location unknown' },
    events: [
      {
        date: '2026-07-16', label: 'First public report', title: 'Hugging Face reports an AI-driven intrusion',
        text: 'Hugging Face reported unauthorized access to a limited set of internal datasets and service credentials. The model provider was unidentified in the disclosure.',
        source: 'Hugging Face', url: 'https://huggingface.co/blog/security-incident-july-2026',
        state: {
          evidence: 'Firsthand report', attribution: 'Provider unknown',
          summary: 'Hugging Face reported that autonomous AI agents had accessed parts of its production infrastructure. The public disclosure left the model provider unidentified.',
        },
      },
      {
        date: '2026-07-21', label: 'Public attribution', title: 'Joint disclosure identifies OpenAI’s evaluation',
        text: 'The companies publicly linked the intrusion to experimental models used in an OpenAI evaluation.',
        source: 'OpenAI & Hugging Face', url: 'https://openai.com/index/hugging-face-model-evaluation-security-incident/',
        state: {
          evidence: 'Joint disclosure', attribution: 'OpenAI evaluation',
          summary: 'OpenAI and Hugging Face publicly linked the intrusion to an internal OpenAI evaluation five days after Hugging Face first disclosed the breach.',
        },
      },
      {
        date: '2026-08-26', label: 'Follow-up report', title: 'OpenAI publishes its investigation findings',
        text: 'OpenAI described the incident, its investigation and changes to evaluation safeguards and incident response.',
        source: 'OpenAI', url: 'https://openai.com/index/hugging-face-incident-and-the-road-ahead/',
        state: {
          evidence: 'Joint disclosure', attribution: 'OpenAI evaluation',
          summary: 'OpenAI linked the intrusion to experimental AI agents from an internal evaluation. A follow-up investigation examined how the agents acted and how safeguards could improve.',
        },
      },
      {
        date: '2026-08-26', label: 'Independent review', title: 'METR and Redwood Research review agent behavior',
        text: 'The researchers separately examined the agents’ reasoning, behavior and collaboration during the incident.',
        source: 'METR & Redwood Research', url: 'https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/',
      },
      {
        date: '2026-11-16', label: 'Legal filing', title: 'California files a lawsuit',
        text: 'California’s attorney general filed a complaint alleging that OpenAI inadequately secured and monitored its testing. The filing records the state’s allegations.',
        source: 'California Department of Justice', url: 'https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf',
      },
    ],
  },
  {
    id: 'aisi-evaluation',
    title: 'UK AISI evaluation near miss',
    category: 'hazard',
    geo: { label: 'Location unknown' },
    events: [
      {
        date: '2026-08-04', label: 'First public report', title: 'AISI reports out-of-scope agent actions',
        text: 'The institute reported 19 unsanctioned actions across 10 of 122 runs, detected on July 28. Its investigation found no evidence of resulting real-world harm.',
        source: 'UK AI Security Institute', url: 'https://www.aisi.gov.uk/blog/incident-report-unsanctioned-agent-behaviour-during-cyber-testing',
        state: {
          evidence: 'Firsthand report', attribution: 'UK AISI evaluation',
          summary: 'During an evaluation with internet access, AI agents took actions outside the scope of testing. AISI reported containment and published its findings.',
        },
      },
    ],
  },
  {
    id: 'air-canada',
    title: 'Air Canada chatbot fare advice',
    category: 'harm',
    geo: { label: 'British Columbia, Canada', lat: 53, lon: -125 },
    events: [
      {
        date: '2024-02-14', label: 'Tribunal decision', title: 'Tribunal rules on misleading chatbot advice',
        text: 'The tribunal found that Air Canada had failed to take reasonable care to ensure its website chatbot was accurate about bereavement fares.',
        source: 'BC Civil Resolution Tribunal', url: 'https://decisions.civilresolutionbc.ca/crt/crtd/en/item/525448/index.do',
        state: {
          evidence: 'Tribunal finding', attribution: 'Air Canada',
          summary: 'A passenger relied on incorrect fare guidance from Air Canada’s website chatbot. A British Columbia tribunal awarded damages.',
        },
      },
    ],
  },
  {
    id: 'rite-aid',
    title: 'Rite Aid facial recognition',
    category: 'regulation',
    geo: { label: 'United States', lat: 39, lon: -98 },
    events: [
      {
        date: '2023-12-19', label: 'Regulatory complaint', title: 'FTC files facial recognition complaint',
        text: 'The FTC alleged that automated false matches led staff to wrongly flag customers in stores around the United States.',
        source: 'Federal Trade Commission', url: 'https://www.ftc.gov/news-events/news/press-releases/2023/12/rite-aid-banned-using-ai-facial-recognition-after-ftc-says-retailer-deployed-technology-without',
        state: {
          evidence: 'Regulatory allegation', attribution: 'Rite Aid deployment',
          summary: 'The FTC alleged that Rite Aid deployed facial recognition without reasonable safeguards against misidentification and harm to consumers.',
        },
      },
      {
        date: '2024-03-08', label: 'Stipulated order', title: 'FTC case docket posts the stipulated order',
        text: 'The case docket lists the stipulated order restricting Rite Aid’s use of facial recognition and requiring safeguards.',
        source: 'Federal Trade Commission', url: 'https://www.ftc.gov/legal-library/browse/cases-proceedings/2023190-rite-aid-corporation-ftc-v',
        state: {
          evidence: 'Stipulated order', attribution: 'Rite Aid deployment',
          summary: 'A stipulated order followed the FTC complaint over facial recognition safeguards. It restricts Rite Aid’s use of the technology.',
        },
      },
    ],
  },
  {
    id: 'italy-chatgpt',
    title: 'Italy restricts ChatGPT processing',
    category: 'regulation',
    geo: { label: 'Italy', lat: 42.5, lon: 12.5 },
    events: [
      {
        date: '2023-03-31', label: 'Regulatory announcement', title: 'Italian regulator announces a temporary limitation',
        text: 'Italy’s data protection authority announced a temporary limitation on OpenAI’s processing of Italian users’ data.',
        source: 'Garante per la protezione dei dati personali', url: garanteDocument + '9870847',
        state: {
          evidence: 'Regulator announcement', attribution: 'OpenAI / ChatGPT',
          summary: 'Italy’s data protection authority imposed a temporary processing limitation and opened an inquiry over data protection concerns.',
        },
      },
      {
        date: '2023-04-28', label: 'Service update', title: 'OpenAI reinstates access in Italy',
        text: 'The regulator reported that OpenAI reinstated ChatGPT access after introducing changes to transparency and user rights.',
        source: 'Garante per la protezione dei dati personali', url: garanteDocument + '9881490',
        state: {
          evidence: 'Regulator announcement', attribution: 'OpenAI / ChatGPT',
          summary: 'ChatGPT access resumed in Italy after OpenAI introduced measures addressing the data protection authority’s initial requirements.',
        },
      },
    ],
  },
  {
    id: 'deepseek-korea',
    title: 'DeepSeek pauses app downloads in South Korea',
    category: 'regulation',
    geo: { label: 'South Korea', lat: 36, lon: 128 },
    events: [
      {
        date: '2025-02-17', label: 'Regulator announcement', title: 'PIPC announces a pause in new app downloads',
        text: 'South Korea’s privacy regulator announced that DeepSeek had temporarily suspended new app downloads while it worked to address privacy requirements.',
        source: 'Korea PIPC', url: 'https://pipc.go.kr/eng/user/ltn/new/noticeDetail.do?bbsId=BBSMSTR_000000000001&nttId=2784',
        state: {
          evidence: 'Regulator announcement', attribution: 'DeepSeek',
          summary: 'DeepSeek paused new app downloads in South Korea following engagement with the country’s privacy regulator.',
        },
      },
      {
        date: '2025-04-24', label: 'Examination findings', title: 'PIPC releases its privacy examination',
        text: 'The regulator recommended changes to cross-border data handling and transparency, among other measures.',
        source: 'Korea PIPC', url: 'https://pipc.go.kr/eng/user/ltn/new/noticeDetail.do?bbsId=BBSMSTR_000000000001&nttId=2819',
        state: {
          evidence: 'Regulatory findings', attribution: 'DeepSeek',
          summary: 'South Korea’s privacy regulator examined DeepSeek’s data handling and recommended corrective measures after the pause in new app downloads.',
        },
      },
    ],
  },
  {
    id: 'meta-brazil',
    title: 'Brazil halts Meta’s AI training with personal data',
    category: 'regulation',
    geo: { label: 'Brazil', lat: -13, lon: -53 },
    events: [
      {
        date: '2024-07-02', label: 'Regulatory announcement', title: 'ANPD announces a preventive suspension',
        text: 'Brazil’s data protection authority announced the suspension of a Meta privacy policy provision permitting use of personal data for AI training.',
        source: 'Brazil ANPD', url: 'https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-determina-suspensao-cautelar-do-tratamento-de-dados-pessoais-para-treinamento-da-ia-da-meta',
        state: {
          evidence: 'Regulator announcement', attribution: 'Meta',
          summary: 'Brazil’s data protection authority took preventive action over Meta’s proposed use of personal data to train AI systems.',
        },
      },
      {
        date: '2024-08-30', label: 'Regulatory update', title: 'ANPD allows a restricted resumption',
        text: 'The authority lifted the suspension after Meta agreed to a compliance plan, subject to restrictions.',
        source: 'Brazil ANPD', url: 'https://www.gov.br/anpd/pt-br/assuntos/noticias/meta-cumpre-exigencias-da-anpd-e-podera-retomar-com-restricoes-o-uso-de-dados-pessoais-para-treinamento-de-inteligencia-artificial',
        state: {
          evidence: 'Regulator announcement', attribution: 'Meta',
          summary: 'Brazil’s privacy authority lifted its preventive suspension after Meta agreed to a compliance plan with restrictions.',
        },
      },
    ],
  },
  {
    id: 'hong-kong-deepfake',
    title: 'Hong Kong deepfake video-call fraud',
    category: 'harm',
    geo: { label: 'Hong Kong', lat: 22.3, lon: 114.2 },
    events: [
      {
        date: '2024-02-07', label: 'Security bulletin', title: 'HKCERT documents the video-call fraud',
        text: 'HKCERT issued a warning describing a case in which an employee was deceived into transferring about HK$200 million.',
        source: 'HKCERT', url: 'https://www.hkcert.org/security-bulletin/phishing-alert-phishing-campaigns-targeting-instagram-backup-codes-to-bypass-2fa-on-the-rise_20240207',
        state: {
          evidence: 'Security bulletin', attribution: 'Actor unidentified in bulletin',
          summary: 'A deepfake video conference was used to impersonate colleagues and convince an employee to transfer company funds.',
        },
      },
      {
        date: '2024-06-26', label: 'Legislative reply', title: 'Hong Kong officials report police findings',
        text: 'In a written reply to the Legislative Council, the Secretary for Security reported that police believed the call used prerecorded footage altered with deepfake technology.',
        source: 'Hong Kong Security Bureau', url: 'https://www.info.gov.hk/gia/general/202406/26/P2024062600192p.htm',
        state: {
          evidence: 'Official account', attribution: 'Actor unidentified in reply',
          summary: 'Hong Kong officials described a prerecorded deepfake video conference linked to roughly HK$200 million in fraudulent transfers.',
        },
      },
    ],
  },

];

export function snapshot(records, asOf) {
  return records.flatMap(record => {
    const events = record.events.filter(event => event.date <= asOf);
    const state = events.findLast(event => event.state)?.state;
    if (!state) return [];
    return [{ ...record, ...state, events, firstReport: events[0].date }];
  });
}

export function publicUrl(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      return url.href;
    }
  } catch {}
  return null;
}
