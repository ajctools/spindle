const storageKey='spindle-prompt-dex-v1';
const comparisonKey='spindle-prompt-dex-comparisons-v1';
const maxEntries=200,maxBytes=2*1024*1024;
const tiers=['Local small','Local large','Reasoning','Vision','Frontier','General'];
const collections=[['','All prompts'],['Writing','Clearer writing'],['Model check','Model checks'],['Workflow','Workflow prompts'],['Vision','Vision']];
const tokenPattern=/\{\{([a-z][a-z0-9_]{0,31})\}\}/gi;
const fields=template=>[...new Set(Array.from(template.matchAll(tokenPattern),match=>match[1]))];
const fieldLabel=name=>name[0].toUpperCase()+name.slice(1).replaceAll('_',' ');

const starters=[
  {
    id:'starter-json',title:'Extract records as strict JSON',tier:'Local small',tags:['JSON','Extraction'],
    template:`Extract action items from the notes below. Return one JSON object with exactly this shape:
{"items":[{"task":"string","owner":"string or null","due":"YYYY-MM-DD or null"}]}

Use null for an owner or date the notes do not explicitly give. Return {"items":[]} if there are no action items. Output JSON only.

Notes:
{{notes}}`,
    sample:{notes:'Maya will submit the revised schedule by 2027-01-12. Archive the old handout. The team approved the budget.'},
    check:'The output parses as JSON and contains exactly two items. Maya’s due date is 2027-01-12. The archive item has a null owner and due date.',
    tuning:'Start with short notes and a low temperature. If the model wraps the object in Markdown or adds fields, validate the JSON before passing it to a workflow.',
    testedWith:'',
  },{
    id:'starter-sources',title:'Answer from supplied sources',tier:'Reasoning',tags:['Grounding','Verification'],
    template:`Answer the question using only the excerpts below. Cite an excerpt ID after each factual claim. If the excerpts disagree, name the disagreement. If they do not establish the answer, say what evidence is missing.

Question:
{{question}}

Excerpts:
{{excerpts}}

Return a short answer followed by any uncertainty that matters.`,
    sample:{question:'When does the equipment desk close on Saturdays, and can visitors borrow a tripod?',excerpts:'[A] The equipment desk is open Saturday from 9:00 a.m. to 1:00 p.m.\n[B] Students and staff with a current badge may borrow tripods.'},
    check:'The answer says 1:00 p.m. and cites [A]. It says the excerpts do not establish borrowing eligibility for visitors.',
    tuning:'Try the same excerpts with thinking on and off. Short, numbered sources make citations easier to check. Compare each citation to its excerpt.',
    testedWith:'',
  },{
    id:'starter-vision',title:'Transcribe a document without guessing',tier:'Vision',tags:['Vision','Transcription'],
    template:`Transcribe the attached document in reading order. Copy visible words, numbers, and punctuation as written. Use [unreadable] for text you cannot make out. Preserve line breaks where they matter.

Area to transcribe:
{{scope}}

Return only the transcription.`,
    sample:{scope:'The document heading and the line items beneath it.'},
    sampleAttachment:'document.png',
    check:'Compare the transcription to the image. Check digits and line order, and verify that any obscured text is marked [unreadable].',
    tuning:'Use a chat model that accepts images. Crop to the area of interest when small text gets blurred or the document spans multiple pages.',
    testedWith:'',
  },{
    id:'starter-cut-filler',title:'Cut filler and keep the facts',tier:'Local small',tags:['Writing','Editing'],
    template:`Edit the draft for a reader who needs the facts quickly. Put the action or decision in the opening sentence. Keep the names, numbers, dates and level of certainty. Cut generic praise, empty introductions, and repetitions. Use the draft as the sole source of factual details. Return only the revised text.

Draft:
{{draft}}`,
    sample:{draft:'We are excited to share an important update about our ongoing efforts. The front desk will open at 10 a.m. on Tuesday while the team replaces the entry lock. We appreciate everyone’s patience as we work through this important transition.'},
    check:'The first sentence says the desk opens at 10 a.m. on Tuesday. The lock replacement remains, and the response adds no promises.',
    tuning:'Try it on one paragraph at a time. If your draft needs its original voice more than a shorter word count, use Suggest line edits.',
    source:{label:'Community discussion on concrete writing',url:'https://www.reddit.com/r/copywriting/comments/1n3u03i/writing_instruction_to_prevent_ai_slop/'},
  },{
    id:'starter-line-edits',title:'Suggest line edits without taking over',tier:'General',tags:['Writing','Editing'],
    template:`Give up to three useful line edits for this draft. For each, quote a short phrase, identify the specific issue, and offer one small replacement that preserves the meaning. Prioritize vague claims, repetition, and buried actions. Leave distinctive phrasing alone when it works. Return the notes as a list so I can choose which edits to make.

Draft:
{{draft}}`,
    sample:{draft:'Well, that was a morning. After a fairly extensive amount of back and forth, we decided to move the rehearsal to the small room. The big room is booked on Thursdays.'},
    check:'The edits target the wordy lead-in and preserve the first sentence’s voice. The rehearsal move and Thursday booking stay intact.',
    tuning:'Use feedback first when preserving authorship matters. Apply the edits you agree with in a second pass.',
    source:{label:'Community discussion on editing versus rewriting',url:'https://www.reddit.com/r/WritingWithAI/comments/1uyyulu/chatgpt_rewrites_instead_of_edits_and_it_took_me/'},
  },{
    id:'starter-house-voice',title:'Write from your own voice sample',tier:'Local large',tags:['Writing','Voice'],
    template:`Write the requested message using the voice sample for sentence length, rhythm, and level of formality. Treat the facts below as the only source for the new message. Keep uncertainty where it appears. Return just the message.

Voice sample:
{{voice_sample}}

Facts and audience:
{{brief}}`,
    sample:{voice_sample:'Quick heads-up. I’ve moved the boxes into the hall. Grab what you need and leave the rest for Friday.',brief:'Write to the workshop crew. The delivery might arrive after 2 p.m. Leave the side entrance clear.'},
    check:'The message is short and direct. It keeps “might,” asks the crew to clear the entrance, and borrows none of the sample’s logistics.',
    tuning:'Use a short example you wrote for a similar audience. Pick a sample with rhythm you want to keep and leave unrelated context out of the brief.',
    source:{label:'Community discussion on supplying voice examples',url:'https://www.reddit.com/r/ChatGPTPromptGenius/comments/1v55ui5/the_prompt_that_makes_chatgpt_write_in_your_voice/'},
  },{
    id:'starter-decision-email',title:'Put the decision first in an email',tier:'Local small',tags:['Writing','Email'],
    template:`Write a short email for the audience in the brief. Open with the decision or request. Follow with the reason and the next action, including who acts and when if supplied. Keep the stated commitments and use everyday words. Return a subject line and the email body.

Brief:
{{brief}}`,
    sample:{brief:'Tell the volunteers we moved setup from 8 to 9 a.m. Saturday because the gate opens at 8:45. Ask team leads to confirm their headcounts by Friday at noon.'},
    check:'The subject or first sentence gives the new setup time. The body gives the reason and asks team leads to confirm by Friday noon.',
    tuning:'Give the model the reader and the action in one short brief. Add background only if the reader needs it to respond.',
  },{
    id:'starter-release-note',title:'Write release notes from a change list',tier:'General',tags:['Writing','Documentation'],
    template:`Write a short release note from these changes. For each user-facing change, say what someone can now do or what happens differently. State how to find the feature when a path is provided. Keep scope limits that affect users. Leave out internal refactors and marketing language.

Changes:
{{changes}}`,
    sample:{changes:'Added a custom prompt library in the Chat sidebar. Added JSON export for custom entries. Refactored button components. Browser preferences are saved per browser.'},
    check:'The note mentions the sidebar, custom entry export, and the per-browser limit. It omits the button refactor and avoids claiming cross-device sync.',
    tuning:'Give the model concrete behavior and entry points. Include any scope limits users need to know.',
  },{
    id:'starter-spoken-script',title:'Make a draft easy to read aloud',tier:'General',tags:['Writing','Workflow','Speech'],
    template:`Prepare the text for spoken delivery. Keep its facts and voice. Split sentences where a listener needs a pause and write abbreviations or symbols in their spoken form when the meaning is clear. Keep unfamiliar names as written. Return only the script text.

Text:
{{text}}`,
    sample:{text:'Pickup starts at 9:30 a.m. on Saturday at the rear gate. Bring your ID and allow 10–15 min. for check-in.'},
    check:'The script speaks nine thirty in the morning and ten to fifteen minutes, and keeps the rear gate and ID instructions.',
    tuning:'Use Chat to prepare the script, then use the result in Speech. Listen for unexpected pronunciation of names and numbers.',
  },{
    id:'starter-format-check',title:'Check exact format following',tier:'Local small',tags:['Model check','Formatting'],
    template:`From the list below, select the items marked ready in their original order. Print READY on the first line. Print each selected item on its own line, exactly as named. Use plain text with no bullets, blank lines, or extra words.

List:
{{list}}`,
    sample:{list:'Maple: ready\nBirch: waiting\nCedar: ready'},
    check:'The output has three lines: READY, Maple, Cedar. Check the result in a fresh chat with each model.',
    tuning:'Use the same input and settings across models. If a model adds commentary, compare the result with thinking off where that control is available.',
    source:{label:'Instruction-Following Evaluation (IFEval)',url:'https://arxiv.org/abs/2311.07911'},
  },{
    id:'starter-null-check',title:'Check JSON with missing values',tier:'Local small',tags:['Model check','JSON','Extraction'],
    template:`Convert these records into a JSON array in input order. Each item has exactly the fields "id", "status", and "due". The status must be "open" or "closed". If a due date is missing, use JSON null. Return the array alone, with no code fence.

Records:
{{records}}`,
    sample:{records:'AA-2 is open and due 2027-02-04.\nBB-8 is closed. No due date was recorded.'},
    check:'The result parses as JSON, has two objects, and uses a real null for BB-8. Check field values and types separately from parsing.',
    tuning:'Try it as a prompt-only check first. If your device runtime offers schema-constrained output, compare it separately and check the field values in both cases.',
    source:{label:'JSONSchemaBench research',url:'https://arxiv.org/abs/2501.10868'},
  },{
    id:'starter-context-check',title:'Check whether the model finds the middle',tier:'Local large',tags:['Model check','Long context','Grounding'],
    template:`Find the value requested below. Use the section marked CURRENT for the named item. Reply with the value and the section ID. If the named item is absent from CURRENT, say it is missing.

Question:
{{question}}

Sections:
{{sections}}`,
    sample:{question:'What is the current pickup time for Delta?',sections:'[A] ARCHIVE: Delta pickup 08:10.\n[B] CURRENT: Delta pickup 11:40.\n[C] ARCHIVE: Delta pickup 15:20.'},
    check:'The answer is 11:40 and cites [B]. Move the current section to the beginning and the end and repeat.',
    tuning:'This short input is a smoke test. Add neutral filler between sections and repeat at a few input lengths to probe a model’s usable context.',
    source:{label:'Lost in the Middle research',url:'https://arxiv.org/abs/2307.03172'},
  },{
    id:'starter-counterexample-check',title:'Find the first constraint a plan breaks',tier:'Reasoning',tags:['Model check','Reasoning','Planning'],
    template:`Check this proposed plan against the constraints in order. Give the first violation, show the short calculation or specific evidence that proves it, then state the smallest change allowed by the constraints. If the plan satisfies every constraint, say so and show the decisive check.

Plan and constraints:
{{plan}}`,
    sample:{plan:'Pack three items weighing 32, 35, and 25 grams. The total must be at most 90 grams. The first two items are fixed. A substitute for the third item can weigh any whole number of grams.'},
    check:'The total is 92 g, exceeding the limit by 2 g. A third item of 23 g is the smallest allowed change by weight.',
    tuning:'Where supported, compare thinking on and off. Score the final calculation and recommendation, and use the run’s reported timing to weigh the difference.',
  },{
    id:'starter-image-check',title:'Check visible details in an image',tier:'Vision',tags:['Model check','Vision','Verification'],
    template:`Answer the questions using visible evidence from the attached image. If the image does not show something, say so. Use one short line per answer.

Questions:
{{questions}}`,
    sample:{questions:'How many points does the central shape have? What color is it relative to the background? Is there visible text?'},
    sampleAttachment:'star.png',
    check:'The sample contains eight points, a bright yellow-green shape on a darker green background, and no visible text.',
    tuning:'Use a chat model that accepts images. For a harder second run, rotate or crop your own test image and check the answer against what is still visible.',
  },{
    id:'starter-handoff',title:'Summarize work for the next model',tier:'Local small',tags:['Workflow','Summarization'],
    template:`Prepare a handoff from the material below. Return four short sections: Goal, Decisions, Open questions, and Next action. Preserve names, filenames, and constraints verbatim where they affect the next step. Keep uncertainty visible. Use “None recorded” for empty sections.

Material:
{{material}}`,
    sample:{material:'Goal: publish a workshop flyer. We chose a Friday draft review. The photo is still missing. Lena will put flyer-v2.pdf in the review folder by Thursday.'},
    check:'The handoff keeps Friday as the review and Thursday as Lena’s deadline, preserves flyer-v2.pdf, and lists the photo as unresolved.',
    tuning:'Use this between long workflow steps when the next model needs decisions and open work. Include source text as well when exact wording matters.',
  },{
    id:'starter-transcript-decisions',title:'Separate transcript decisions from proposals',tier:'Local large',tags:['Workflow','Transcription','Extraction'],
    template:`Read the transcript. List decisions that speakers clearly agreed on. Then list proposals that remain open, and action items with named owners when given. Include a short supporting quote for each decision. Keep ambiguous speaker attribution explicit.

Transcript:
{{transcript}}`,
    sample:{transcript:'Ravi: Could we move to Monday? Ana: Let’s keep Tuesday. Ravi: Agreed, Tuesday. Ana: I’ll send the agenda. Ravi: Maybe we can invite the supplier too.'},
    check:'Tuesday is the only agreed scheduling decision, Ana owns the agenda, and the supplier invitation remains open.',
    tuning:'Run after Transcribe. Keep time stamps and speaker labels if available, and spot-check the supporting quotes against the recording when decisions matter.',
  },{
    id:'starter-diff-review',title:'Review a change for behavior regressions',tier:'Reasoning',tags:['Workflow','Code review'],
    template:`Review the proposed change against the stated contract. Identify concrete behavior regressions and give one minimal input that demonstrates each. Refer to the changed expression. If the contract is satisfied, give one boundary case worth checking. Keep the review focused on observable behavior.

Contract and change:
{{change}}`,
    sample:{change:'A page may contain up to 50 items, including exactly 50. The old condition was count <= 50. The new condition is count < 50.'},
    check:'It identifies count = 50 as the regression and points to the changed comparison.',
    tuning:'Supply a small diff and the expected behavior. Use the result to choose a regression test and confirm it in your actual code.',
  },{
    id:'starter-reconcile-notes',title:'Reconcile two drafts without flattening disagreements',tier:'Local large',tags:['Workflow','Grounding','Summarization'],
    template:`Compare draft A and draft B. Return three sections: Shared facts, Differences to resolve, and Useful detail unique to one draft. Label each difference with its draft and keep conflicting numbers side by side. Keep proposals distinct from stated facts.

Draft A:
{{draft_a}}

Draft B:
{{draft_b}}`,
    sample:{draft_a:'Both teams will run the workshop. The room seats 24. Doors open at 6:30.',draft_b:'Both teams will run the workshop. The room seats 30. Add a printed agenda if time permits.'},
    check:'It preserves the capacity disagreement, keeps 6:30 attributed to draft A, and marks the agenda as a proposal.',
    tuning:'Give each source a stable label. Resolve disagreements with the original material before asking for a merged draft.',
  },{
    id:'starter-video-motion',title:'Turn a still image brief into a motion prompt',tier:'General',tags:['Workflow','Video'],
    template:`Write one short image-to-video prompt for the brief below. Describe one camera movement and one subject movement that could fit the clip length. State what should stay consistent from the starting image. Return one paragraph that describes visible changes over time.

Starting image and clip brief:
{{brief}}`,
    sample:{brief:'A still of a blue cup beside a rainy window. Five-second clip. Keep the cup, framing and overcast light recognizable.'},
    check:'It proposes one modest camera motion and a visible movement such as a raindrop sliding, while preserving the blue cup and light.',
    tuning:'Use the result in Video with the actual starting image attached. Try one movement at a time when checking a new model.',
  },{
    id:'starter-invoice-fields',title:'Read specific fields from an invoice image',tier:'Vision',tags:['Vision','Workflow','Extraction'],
    template:`Read only the requested fields from the attached invoice image. For each field, give the visible value and the printed label next to it. Use “not visible” when either is missing or unreadable. Copy displayed amounts and dates exactly.

Fields:
{{fields}}`,
    sample:{fields:'Invoice number, invoice date, and total amount.'},
    sampleAttachment:'document.png',
    check:'Compare each value and its label directly to the image. A calculated total or inferred date fails this check.',
    tuning:'Crop to the heading or totals when lettering is small. For long documents, transcribe the relevant page before extracting fields.',
  },
];

function plain(value,label,max,required=false){
  if(value===undefined&&!required)return '';
  if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('Check '+label+' (up to '+max+' characters).');
  return value.trim();
}
function normalize(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Each prompt must be a JSON object.');
  const template=plain(entry.template,'the prompt',12000,true),names=fields(template);
  if(names.length>12)throw Error('Use up to 12 placeholders per prompt.');
  if(!tiers.includes(entry.tier))throw Error('Choose a supported model tier.');
  const tags=entry.tags??[];
  if(!Array.isArray(tags)||tags.length>8)throw Error('Use up to eight capability tags.');
  const sample=entry.sample??{};
  if(typeof sample!=='object'||Array.isArray(sample))throw Error('Sample inputs must be a JSON object.');
  return {
    title:plain(entry.title,'the title',100,true),tier:entry.tier,
    tags:[...new Set(tags.map(tag=>plain(tag,'the capability tags',30,true)))],template,
    sample:Object.fromEntries(names.map(name=>[name,plain(Object.hasOwn(sample,name)?sample[name]:undefined,'sample '+name,4000)])),
    check:plain(entry.check,'the success check',1200),tuning:plain(entry.tuning,'the tuning notes',1200),
    testedWith:plain(entry.testedWith,'tested with',200),
  };
}
export function parsePromptDex(text){
  const data=JSON.parse(text);
  if(data?.version!==1||!Array.isArray(data.entries)||data.entries.length>maxEntries)throw Error('Choose a PromptDex v1 JSON file with up to 200 prompts.');
  return data.entries.map(entry=>({
    ...normalize(entry),
    id:typeof entry.id==='string'&&/^[a-f0-9-]{36}$/i.test(entry.id)?entry.id:crypto.randomUUID(),
  }));
}
function storedPrompts(storage){
  const text=storage?.getItem(storageKey);
  return text?parsePromptDex(text):[];
}
export function searchPromptDex(storage){
  try{return [...starters,...storedPrompts(storage)];}catch{return starters;}
}
export function fillPrompt(template,values){
  return template.replace(tokenPattern,(token,name)=>Object.hasOwn(values,name)&&values[name].trim()?values[name]:token);
}
function mergePrompts(existing,incoming){
  const signatures=new Set(existing.map(({id,...entry})=>JSON.stringify(entry)));
  const ids=new Set(existing.map(entry=>entry.id)),added=[];
  for(const {id,...entry} of incoming){
    const signature=JSON.stringify(entry);
    if(signatures.has(signature))continue;
    signatures.add(signature);
    const nextId=ids.has(id)?crypto.randomUUID():id;
    ids.add(nextId);
    added.push({...entry,id:nextId});
  }
  return [...existing,...added];
}

export function createPromptDex({storage,escape:esc,onUse,getModels,getRun,queueComparison}){
  const dialog=document.createElement('dialog');
  dialog.className='prompt-dex';
  dialog.setAttribute('aria-labelledby','prompt-dex-title');
  dialog.innerHTML=`<div class="prompt-dex-shell">
    <header class="prompt-dex-header"><div><h2 id="prompt-dex-title">PromptDex</h2><p>Recipes you can tune and reuse in chat.</p></div>
      <div class="actions"><button type="button" class="button primary" data-dex="add">Add prompt</button>
        <button type="button" class="button quiet" data-dex="close" aria-label="Close PromptDex">×</button></div></header>
    <div class="prompt-dex-filters"><label><span class="sr-only">Search prompts</span><input type="search" placeholder="Search prompts…" id="dex-search"></label>
      <label><span class="sr-only">Model tier</span><select id="dex-tier"><option value="">All model tiers</option>${tiers.map(t=>`<option>${t}</option>`).join('')}</select></label>
      <label><span class="sr-only">Capability</span><select id="dex-capability"></select></label>
      <div class="prompt-dex-collections" role="group" aria-label="Prompt collections">
        ${collections.map(([tag,label])=>`<button class="button quiet" type="button" data-collection="${tag}">${label}</button>`).join('')}
      </div></div>
    <div class="prompt-dex-content"><div class="prompt-dex-index"><p id="dex-count"></p><div id="dex-list" aria-label="Prompts"></div></div>
      <div id="dex-detail" class="prompt-dex-detail"></div></div>
    <footer class="prompt-dex-footer"><p id="dex-status" role="status">Custom prompts are saved in this browser.</p>
      <div class="actions"><button type="button" class="button quiet" data-dex="import">Import JSON</button>
      <button type="button" class="button quiet" data-dex="export">Export my prompts</button>
      <input id="dex-file" type="file" accept=".json,application/json" hidden></div></footer></div>`;
  document.body.append(dialog);
  const find=selector=>dialog.querySelector(selector);
  const search=find('#dex-search'),tier=find('#dex-tier'),capability=find('#dex-capability'),list=find('#dex-list'),detail=find('#dex-detail');
  const status=find('#dex-status'),file=find('#dex-file'),exportButton=find('[data-dex="export"]');
  let mine=[],selected=starters[0].id,editor=null,values={},sampleLoaded=false;
  let comparisons=[],comparing=false,comparisonId='',comparisonRevision='',submitting=false;
  const entries=()=>[...starters,...mine];
  const current=()=>entries().find(entry=>entry.id===selected);
  const tell=message=>{status.textContent=message;};

  const stored=()=>storedPrompts(storage);
  function persist(next){
    const text=JSON.stringify({version:1,entries:next});
    if(next.length>maxEntries||new Blob([text]).size>maxBytes)throw Error('The library can hold up to 200 prompts and 2 MiB.');
    try{storage.setItem(storageKey,text);}catch{throw Error('Browser storage could not save the library.');}
    mine=next;
  }
  function select(id){
    if(id===selected)return;
    selected=id;values={};sampleLoaded=false;comparing=false;comparisonId='';
  }
  function renderList(){
    const tag=capability.value;
    const tags=[...new Set(entries().flatMap(entry=>entry.tags))].sort((a,b)=>a.localeCompare(b));
    capability.replaceChildren(new Option('All capabilities',''),...tags.map(tag=>new Option(tag,tag)));
    if(tags.includes(tag))capability.value=tag;
    for(const button of dialog.querySelectorAll('[data-collection]')){
      const selectedCollection=button.dataset.collection===capability.value;
      button.setAttribute('aria-pressed',selectedCollection&&(!!capability.value||!tier.value&&!search.value.trim()));
    }
    const query=search.value.trim().toLowerCase();
    const visible=entries().filter(entry=>(!tier.value||entry.tier===tier.value)
      &&(!capability.value||entry.tags.includes(capability.value))
      &&[entry.title,entry.template,entry.tuning,entry.testedWith,...entry.tags].join(' ').toLowerCase().includes(query));
    if(!editor&&!visible.some(entry=>entry.id===selected))select(visible[0]?.id||'');
    find('#dex-count').textContent=visible.length+(visible.length===1?' prompt':' prompts');
    list.innerHTML=visible.map(entry=>`<button type="button" class="prompt-dex-entry" data-entry="${esc(entry.id)}" aria-pressed="${entry.id===selected&&!editor}">
      <strong>${esc(entry.title)}</strong><span>${esc(entry.tier)}${entry.id.startsWith('starter-')?'':' · Mine'}</span></button>`).join('');
    exportButton.disabled=!mine.length;
  }
  function updatePreview(){
    const entry=current(),preview=find('#dex-preview');
    if(!entry||!preview)return;
    preview.value=fillPrompt(entry.template,values);
    find('[data-dex="use"]').disabled=!inputsReady(entry);
  }
  const inputsReady=entry=>fields(entry.template).every(name=>Object.hasOwn(values,name)&&values[name].trim());
  function renderDetail(){
    const entry=current();
    if(!entry){detail.innerHTML='<p class="prompt-dex-empty">No matching prompts. Change the filters or add a prompt.</p>';return;}
    const names=fields(entry.template);
    const hasSample=Object.values(entry.sample).some(Boolean);
    detail.innerHTML=`<div class="prompt-dex-detail-body"><div class="prompt-dex-detail-head"><div>
      <div class="prompt-dex-tags"><span class="pill live">${esc(entry.tier)}</span>${entry.tags.map(tag=>`<span class="pill">${esc(tag)}</span>`).join('')}</div>
      <h3>${esc(entry.title)}</h3></div>
      <div class="actions"><button type="button" class="button quiet" data-dex="clone">Clone & edit</button>
      ${entry.id.startsWith('starter-')?'':'<button type="button" class="button quiet" data-dex="edit">Edit</button>'}</div></div>
      <dl class="prompt-dex-notes"><div><dt>Tested with</dt><dd>${esc(entry.testedWith||'Awaiting a device run')}</dd></div>
        ${entry.tuning?`<div><dt>Tuning notes</dt><dd>${esc(entry.tuning)}</dd></div>`:''}
        ${entry.check?`<div><dt>What to check</dt><dd>${esc(entry.check)}</dd></div>`:''}
        ${entry.source?`<div><dt>Further reading</dt><dd><a href="${esc(entry.source.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.source.label)}</a></dd></div>`:''}</dl>
      ${names.length?`<div class="prompt-dex-fields"><div class="prompt-dex-fields-heading"><h4>Prompt inputs</h4>
        ${hasSample?'<button type="button" class="button quiet" data-dex="sample">Fill sample inputs</button>':''}</div>
        ${names.map(name=>`<label class="field"><span>${esc(fieldLabel(name))}</span><textarea rows="2" maxlength="12000" data-input="${esc(name)}">${esc(Object.hasOwn(values,name)?values[name]:'')}</textarea></label>`).join('')}
      </div>`:''}
      ${entry.sampleAttachment?'<p class="help">Fill the sample inputs to include the sample image when you use this recipe. Select an image-capable model in Chat.</p>':''}
      <label class="field prompt-dex-preview"><span>Prompt preview</span><textarea id="dex-preview" rows="8" readonly></textarea></label></div>
      <div class="actions prompt-dex-detail-actions"><button type="button" class="button primary" data-dex="use">Use in chat</button>
      <button type="button" class="button" data-dex="compare">Compare models</button>
      <button type="button" class="button" data-dex="copy">Copy prompt</button></div>`;
    updatePreview();
  }
  function savedComparisons(){
    try{
      const stored=JSON.parse(storage?.getItem(comparisonKey)||'null');
      return Array.isArray(stored)?stored.filter(row=>typeof row?.id==='string'&&typeof row.recipe==='string'&&Number.isFinite(row.at)):comparisons;
    }catch{return comparisons;}
  }
  function saveComparison(record){
    comparisons=[record,...savedComparisons().filter(row=>row.id!==record.id)].sort((a,b)=>b.at-a.at).slice(0,100);
    try{storage.setItem(comparisonKey,JSON.stringify(comparisons));return true;}
    catch{return false;}
  }
  function comparisonReady(){
    const form=find('#dex-compare-form');
    if(!form)return;
    const entry=current(),models=getModels();
    const a=models.find(model=>model.id===form.elements.first?.value);
    const b=models.find(model=>model.id===form.elements.second?.value);
    const allowance=find('#dex-compare-limit');
    const max=Math.min(a?.limit??32768,b?.limit??32768);
    allowance.textContent=a&&b?'Both models get up to '+max.toLocaleString()+' response tokens.':'';
    const hasImage=!!form.elements.attachment?.files.length||!!(entry.sampleAttachment&&sampleLoaded);
    const active=comparisons.some(row=>row.recipe===entry.id&&['queued','running'].includes(getRun(row.id)?.status));
    form.querySelector('button[type="submit"]').disabled=submitting||active||!a||!b||a.id===b.id||!inputsReady(entry)||(entry.tier==='Vision'||entry.sampleAttachment)&&!hasImage;
    return max;
  }
  function renderComparisonResults(force=false){
    const target=find('#dex-compare-results');
    if(!target)return;
    const record=comparisons.find(row=>row.id===comparisonId&&row.recipe===selected),run=record&&getRun(record.id);
    const revision=JSON.stringify([comparisonId,run?.status,run?.phase,run?.outputs.length,run?.error,run?.restoreError]);
    if(!force&&revision===comparisonRevision)return;
    comparisonRevision=revision;
    if(!record){target.innerHTML='';return;}
    if(!run){target.innerHTML='<p class="help">Waiting for this run to appear in the local history.</p>';return;}
    const models=getModels(),duration=ms=>Number.isFinite(ms)?(ms/1000).toFixed(2)+' s':'Unavailable';
    target.innerHTML=`<div class="prompt-dex-run-status" role="status"><strong>${esc(run.status==='queued'?'Queued':run.status==='running'?run.phase||'Running':fieldLabel(run.status))}</strong>
      ${run.status==='queued'?'<span>Starts after earlier runs finish.</span>':''}</div>
      ${run.error?`<p class="error">${esc(run.error)}</p>`:''}
      ${run.restoreError?`<p class="error">${esc(run.restoreError)}</p>`:''}
      ${record.check?`<p class="prompt-dex-compare-check"><strong>Recipe check</strong> ${esc(record.check)}</p>`:''}
      <div class="prompt-dex-answers">${run.steps.map((step,index)=>{
        const output=run.outputs[index],model=models.find(candidate=>candidate.id===step.model);
        const tokens=output?.metrics?.outputTokens;
        return `<article><h4>${esc(model?.name||step.model)}</h4>
          ${model?.name&&model.name!==step.model?`<p class="help">${esc(step.model)}</p>`:''}
          ${output?`<dl><div><dt>Generation</dt><dd>${duration(output.measurement?.executionMs)}</dd></div>
            <div><dt>Preparation</dt><dd>${duration(output.measurement?.prepareMs)}</dd></div>
            <div><dt>Output tokens</dt><dd>${Number.isFinite(tokens)?tokens.toLocaleString():'Unreported'}</dd></div></dl>
            ${output.finishReason==='length'?'<p class="help">Reached the response allowance.</p>':''}
            ${output.text?`<pre>${esc(output.text)}</pre>`:'<p class="help">The model returned reasoning without a final answer.</p>'}
            <label class="field"><span>Review result</span><select data-dex-verdict="${index}">
              ${[['','Unreviewed'],['pass','Met the check'],['fail','Missed the check']].map(([value,label])=>`<option value="${value}" ${(record.verdicts?.[index]||'')===value?'selected':''}>${label}</option>`).join('')}</select></label>`:
          `<p class="help">${['queued','running'].includes(run.status)?'Awaiting an answer.':'No answer saved.'}</p>`}</article>`;
      }).join('')}</div>`;
  }
  function renderCompare(entry){
    const prior=comparisons.filter(row=>row.recipe===entry.id);
    if(!prior.some(row=>row.id===comparisonId))comparisonId=prior[0]?.id||'';
    const vision=entry.tier==='Vision'||!!entry.sampleAttachment;
    const models=getModels().filter(model=>!vision||model.vision).sort((a,b)=>Number(b.loaded)-Number(a.loaded));
    const options=models.map(model=>`<option value="${esc(model.id)}">${esc(model.name)}${model.loaded?' · loaded':''}</option>`).join('');
    detail.innerHTML=`<div class="prompt-dex-detail-body">
      <button class="button quiet" type="button" data-dex="back">Back to prompt</button>
      <h3>Compare models</h3><p class="help">${esc(entry.title)}</p>
      <details class="prompt-dex-compare-setup" ${prior.length?'':'open'}><summary>New comparison</summary>
      <form id="dex-compare-form">
        <div class="field-row"><label class="field"><span>First model</span><select name="first"><option value="">Choose a model</option>${options}</select></label>
        <label class="field"><span>Second model</span><select name="second"><option value="">Choose a model</option>${options}</select></label></div>
        ${vision?`<label class="field"><span>${sampleLoaded&&entry.sampleAttachment?'Sample image selected. Upload a replacement if needed.':'Image for both models'}</span>
          <input type="file" name="attachment" accept="image/png,image/jpeg,image/webp"></label>`:''}
        ${!inputsReady(entry)?'<p class="help">Fill the prompt inputs before queuing a new comparison.</p>':''}
        ${models.length<2?`<p class="help">Download two ${vision?'image-capable ':''}chat models to compare.</p>`:''}
        <p class="help">Both models get the same prompt with web search off and use their default thinking settings. Spindle runs them in order and restores the previously loaded models afterward.</p>
        <p class="help" id="dex-compare-limit"></p>
        <button type="submit" class="button primary">Queue comparison</button>
      </form></details>
      ${prior.length?`<label class="field"><span>Comparison history</span><select id="dex-compare-history">${prior.map(row=>`<option value="${esc(row.id)}" ${row.id===comparisonId?'selected':''}>${esc(new Date(row.at).toLocaleString())}</option>`).join('')}</select></label>`:''}
      <div id="dex-compare-results"></div></div>`;
    const form=find('#dex-compare-form');
    if(models[0])form.elements.first.value=models[0].id;
    if(models[1])form.elements.second.value=models[1].id;
    form.addEventListener('change',comparisonReady);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(form.querySelector('button[type="submit"]').disabled)return;
      const limit=comparisonReady(),attachment=form.elements.attachment?.files[0];
      const selection=[form.elements.first.value,form.elements.second.value];
      submitting=true;comparisonReady();
      try{
        const id=await queueComparison({title:entry.title,prompt:fillPrompt(entry.template,values),models:selection,limit,attachment,sampleName:sampleLoaded?entry.sampleAttachment:null});
        const persisted=saveComparison({id,recipe:entry.id,at:Date.now(),check:entry.check,verdicts:[]});
        if(comparing&&selected===entry.id){comparisonId=id;renderCompare(entry);}
        tell(persisted?'Comparison queued. Follow it here or in Library & runs.':'Comparison queued. Browser storage could not save its history link.');
      }catch(error){tell(error.message);}
      finally{submitting=false;comparisonReady();}
    });
    find('#dex-compare-history')?.addEventListener('change',event=>{comparisonId=event.target.value;renderComparisonResults(true);});
    find('#dex-compare-results').addEventListener('change',event=>{
      const index=event.target.dataset.dexVerdict,record=comparisons.find(row=>row.id===comparisonId);
      if(index===undefined||!record)return;
      const verdicts=[...(record.verdicts||[])];verdicts[Number(index)]=event.target.value;
      tell(saveComparison({...record,verdicts})?'Review saved in this browser.':'Browser storage could not save this review.');
    });
    comparisonReady();renderComparisonResults(true);
  }
  function renderEditor(entry){
    editor=entry;comparing=false;
    const input=(name,label,max)=>`<label class="field"><span>${label}</span><input name="${name}" maxlength="${max}" value="${esc(entry[name])}"></label>`;
    const textarea=(name,label,rows,max)=>`<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}" maxlength="${max}">${esc(entry[name])}</textarea></label>`;
    detail.innerHTML=`<form id="dex-editor"><h3>${entry.id?'Edit prompt':'Add prompt'}</h3>
      ${input('title','Title',100)}
      <label class="field"><span>Model tier</span><select name="tier">${tiers.map(t=>`<option ${t===entry.tier?'selected':''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Capability tags, separated by commas</span><input name="tags" maxlength="260" value="${esc(entry.tags.join(', '))}"></label>
      ${textarea('template','Prompt template',7,12000)}
      <p class="help">Use <code>{{notes}}</code> to give a prompt a fillable input.</p>
      <div id="dex-editor-samples"></div>
      ${input('testedWith','Tested with (model and settings)',200)}
      ${textarea('tuning','Tuning notes',2,1200)}
      ${textarea('check','What to check',2,1200)}
      <div class="actions"><button type="submit" class="button primary">Save prompt</button>
      <button type="button" class="button quiet" data-dex="cancel">Cancel</button>
      ${entry.id?'<button type="button" class="button danger" data-dex="delete">Delete prompt</button>':''}</div></form>`;
    const form=find('#dex-editor'),sampleFields=find('#dex-editor-samples'),samples={...entry.sample};
    function updateSamples(){
      const inputs=[...sampleFields.querySelectorAll('textarea')];
      for(const el of inputs)samples[el.dataset.sample]=el.value;
      const names=fields(form.elements.template.value).slice(0,12);
      if(names.length===inputs.length&&names.every((name,i)=>name===inputs[i].dataset.sample))return;
      sampleFields.innerHTML=names.map(name=>`<label class="field"><span>Sample ${esc(fieldLabel(name))}</span><textarea rows="2" maxlength="4000" data-sample="${esc(name)}">${esc(Object.hasOwn(samples,name)?samples[name]:'')}</textarea></label>`).join('');
    }
    form.elements.template.addEventListener('input',updateSamples);
    updateSamples();
    form.addEventListener('submit',event=>{
      event.preventDefault();
      try{
        const inputs=Object.fromEntries(new FormData(form));
        const sample=Object.fromEntries([...sampleFields.querySelectorAll('textarea')].map(el=>[el.dataset.sample,el.value]));
        const saved={...normalize({...inputs,tags:inputs.tags.split(',').map(tag=>tag.trim()).filter(Boolean),sample}),id:entry.id||crypto.randomUUID()};
        const latest=stored();
        persist(entry.id&&latest.some(item=>item.id===entry.id)?latest.map(item=>item.id===entry.id?saved:item):[...latest,saved]);
        editor=null;search.value=tier.value=capability.value='';values={};sampleLoaded=false;
        select(saved.id);renderList();renderDetail();tell('Prompt saved in this browser.');
      }catch(error){tell(error.message);}
    });
    renderList();form.elements.title.focus();
  }
  const refresh=()=>{
    renderList();
    if(!editor){
      if(comparing&&current())renderCompare(current());
      else renderDetail();
    }
  };
  for(const control of [search,tier,capability])control.addEventListener(control===search?'input':'change',refresh);
  detail.addEventListener('input',event=>{
    if(!event.target.matches('[data-input]'))return;
    values[event.target.dataset.input]=event.target.value;
    updatePreview();
  });
  dialog.addEventListener('click',async event=>{
    const collection=event.target.closest('[data-collection]');
    if(collection){
      capability.value=collection.dataset.collection;
      if(!capability.value)search.value=tier.value='';
      refresh();return;
    }
    const pick=event.target.closest('[data-entry]');
    if(pick){editor=null;select(pick.dataset.entry);refresh();list.querySelector('[aria-pressed="true"]')?.focus();return;}
    const button=event.target.closest('[data-dex]');
    const action=button?.dataset.dex;
    const entry=current();
    try{
      if(action==='close')dialog.close();
      if(action==='add')renderEditor({title:'',tier:'General',tags:[]});
      if(action==='clone')renderEditor({...entry,id:undefined,title:(entry.title.slice(0,93)+' (copy)')});
      if(action==='edit')renderEditor(entry);
      if(action==='cancel'){editor=null;refresh();}
      if(action==='delete'&&confirm('Delete this custom prompt from PromptDex?')){
        persist(stored().filter(entry=>entry.id!==editor.id));editor=null;refresh();tell('Prompt deleted.');
      }
      if(action==='sample'){values={...entry.sample};sampleLoaded=true;renderDetail();find('[data-dex="sample"]').focus();}
      if(action==='compare'){
        if(!Object.values(values).some(value=>value.trim())&&Object.values(entry.sample).some(Boolean)){values={...entry.sample};sampleLoaded=true;}
        comparing=true;renderCompare(entry);
      }
      if(action==='back'){comparing=false;renderDetail();find('[data-dex="compare"]').focus();}
      if(action==='copy'){
        const preview=find('#dex-preview');
        try{await navigator.clipboard.writeText(preview.value);tell('Prompt copied.');}
        catch{preview.focus();preview.select();tell('Prompt selected. Copy it with your keyboard.');}
      }
      if(action==='use'){
        button.disabled=true;
        try{await onUse(find('#dex-preview').value,sampleLoaded?entry.sampleAttachment:null);dialog.close();}
        finally{updatePreview();}
      }
      if(action==='import')file.click();
      if(action==='export'){
        const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,entries:mine},null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download='spindle-prompt-dex.json';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }catch(error){tell(error.message);}
  });
  file.addEventListener('change',async()=>{
    try{
      const selectedFile=file.files[0];if(!selectedFile)return;
      if(selectedFile.size>maxBytes)throw Error('Choose a JSON file under 2 MiB.');
      const latest=stored(),next=mergePrompts(latest,parsePromptDex(await selectedFile.text()));
      persist(next);refresh();
      tell(next.length===latest.length?'These prompts are already in your library.':`Imported ${next.length-latest.length} custom prompts.`);
    }catch(error){tell('Import failed. '+error.message);}
    finally{file.value='';}
  });
  return {
    update(){
      if(dialog.open&&comparing){comparisonReady();renderComparisonResults();}
    },
    open(id){
      if(dialog.open)return;
      tell('Custom prompts are saved in this browser.');
      try{mine=stored();}catch{tell('Saved prompts could not be read from browser storage.');}
      comparisons=savedComparisons();
      if(id&&entries().some(entry=>entry.id===id)){
        search.value='';tier.value='';capability.value='';editor=null;select(id);
      }
      refresh();dialog.showModal();search.focus();
    },
  };
}
