import {artifactName,downloadArtifact} from './artifact-download.mjs';
import {chatMarkdown} from './chat-ui.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const route = '/api/projects';
const briefLimit = 2800;

export const projectDialog = `<dialog id="project-dialog" class="project-dialog" aria-labelledby="project-dialog-title">
  <header class="actions"><h2 id="project-dialog-title">Projects</h2><form method="dialog"><button class="button quiet" aria-label="Close projects">Close</button></form></header>
  <p data-project-error role="alert" class="error" hidden></p><div data-project-body></div>
</dialog>`;

export function createProjectControls({api,toast,activate,activeId}) {
  let pendingRun = null;
  let dialog, body, error;
  const post = fields => api(route, fields);
  const get = id => api(id ? `${route}?id=${encodeURIComponent(id)}` : route);
  const button = (text, action, value = '', style = 'quiet') => `<button class="button ${style}" type="button" data-project-action="${action}" value="${esc(value)}">${esc(text)}</button>`;
  const report = problem => {
    if (!dialog?.open) return toast(problem.message);
    error.hidden = false;
    error.textContent = problem.message;
  };

  function mount(element) {
    dialog = element;
    if (!dialog) return;
    body = dialog.querySelector('[data-project-body]');
    error = dialog.querySelector('[data-project-error]');
    dialog.addEventListener('click', event => {
      const control = event.target.closest('[data-project-action]');
      if (control) void perform(control);
    });
    dialog.addEventListener('submit', event => {
      const {target} = event;
      if (!target.matches('[data-project-form]')) return;
      event.preventDefault();
      void submit(target);
    });
    dialog.addEventListener('change', event => {
      if (event.target.matches('[data-import-project]') && event.target.files[0]) void importFile(event.target.files[0]);
    });
  }

  function start() {
    error.hidden = true;
    body.innerHTML = '<p role="status">Loading projects…</p>';
    if (!dialog.open) dialog.showModal();
  }

  async function showList() {
    const projects = await get();
    if (!dialog.open) return;
    body.innerHTML = `${pendingRun ? '<p>Choose a project for this checkpoint.</p>' : ''}
      <ul class="project-list">${projects.map(project => `<li>${button(project.name, pendingRun ? 'save' : 'view', project.id)}<span class="small muted">${project.count} saved</span></li>`).join('')}</ul>
      <form data-project-form="create" class="project-form"><label class="field"><span>New project name</span><input name="name" required maxlength="120"></label><button type="submit" class="button">${pendingRun ? 'Create and save' : 'Create project'}</button></form>
      ${pendingRun ? '' : `<footer class="actions">${activeId() ? button('Leave project', 'activate') : ''}${button('Import project', 'import')}<input type="file" accept=".json,application/json" data-import-project hidden></footer>`}`;
  }

  async function showProject(id, checkpointId) {
    const project = await get(id);
    if (!dialog.open) return;
    const checkpoint = project.checkpoints.find(item => item.id === checkpointId);
    body.innerHTML = `<div class="actions">${button('All projects', 'list')}${activeId() !== id ? button('Open project', 'activate', id, 'primary') : ''}</div>
      <h3>${esc(project.name)}</h3>
      ${checkpoint ? `<form class="project-form" data-project-form="edit" data-project="${esc(id)}" data-checkpoint="${esc(checkpoint.id)}">
        <label class="field"><span>Title</span><input name="title" maxlength="100" value="${esc(checkpoint.title)}" required></label>
        <label class="field"><span>Brief used for recall</span><textarea name="brief" rows="5" maxlength="${briefLimit}" required>${esc(checkpoint.brief)}</textarea></label>
        <div class="actions"><button class="button" type="submit">Save changes</button>${button('Draft with Tiiny', 'draft', id)}</div></form>
        <details><summary>Original reply</summary><div class="project-original">${chatMarkdown(checkpoint.result)}</div></details>
        ${checkpoint.sources.length ? `<ul>${checkpoint.sources.map(({url,title})=>`<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a></li>`).join('')}</ul>` : ''}
        <div class="actions">${button('Resume', 'resume', id, 'primary')}${button('Refine original', 'refine', id)}${button('Export Markdown', 'markdown', id)}${button('Delete checkpoint', 'remove', id)}</div>${button('Back to checkpoints', 'view', id)}` :
      `${project.checkpoints.length ? `<div class="actions">${button('Resume latest', 'latest', id, 'primary')}${button('Export project', 'export', id)}</div>
        <ul class="project-list">${project.checkpoints.map(item => `<li><button type="button" class="button quiet" data-project-action="detail" data-checkpoint="${esc(item.id)}" value="${esc(id)}">${esc(item.title)}</button></li>`).join('')}</ul>` : '<p class="help">Save a reply as a checkpoint to make it available for recall in this project.</p>'}`}`;
  }

  async function save(id, runId) {
    await post({action:'save',projectId:id,runId});
    toast('Checkpoint saved.');
  }

  async function importFile(file) {
    try {
      if (file.size > 24 * 1024 * 1024) throw Error('This project export exceeds 24 MiB.');
      const {id} = await post({action:'import',bundle:JSON.parse(await file.text())});
      await showProject(id);
      toast('Project imported.');
    } catch (problem) { report(problem); }
  }

  async function submit(form) {
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    error.hidden = true;
    try {
      const fields = Object.fromEntries(new FormData(form));
      if (form.dataset.projectForm === 'create') {
        const {id} = await post({action:'create',name:fields.name});
        if (pendingRun) {
          await save(id, pendingRun);
          dialog.close();
        } else if (activate(id)) dialog.close();
        else await showProject(id);
      } else {
        await post({...fields,action:'edit',projectId:form.dataset.project,checkpointId:form.dataset.checkpoint});
        toast('Checkpoint updated.');
        await showProject(form.dataset.project, form.dataset.checkpoint);
      }
    } catch (problem) { report(problem); }
    finally { submitButton.disabled = false; }
  }

  async function perform(control) {
    const action = control.dataset.projectAction;
    const id = control.value;
    const detail = body.querySelector('[data-checkpoint]')?.dataset.checkpoint;
    control.disabled = true;
    error.hidden = true;
    try {
      if (action === 'list') await showList();
      else if (action === 'view') await showProject(id);
      else if (action === 'detail') await showProject(id, control.dataset.checkpoint);
      else if (action === 'import') body.querySelector('[data-import-project]').click();
      else if (action === 'save') {
        await save(id, pendingRun);
        dialog.close();
      } else if (action === 'activate') {
        if (activate(id)) dialog.close();
      } else if (action === 'remove') {
        if (!confirm('Delete this checkpoint from project memory? The original chat stays in history.')) return;
        await post({action:'remove',projectId:id,checkpointId:detail});
        await showProject(id);
      } else if (action === 'draft') {
        const {brief} = await post({action:'draft',projectId:id,checkpointId:detail});
        const field = body.querySelector('[name="brief"]');
        if (body.querySelector('form[data-checkpoint]')?.dataset.checkpoint === detail) {
          field.value = brief;
          field.focus();
          toast('Draft ready. Save changes to use it for recall.');
        }
      } else {
        const project = await get(id);
        if (action === 'export') {
          const checkpoints = project.checkpoints.map(({title,brief,result,sources,savedAt})=>({title,brief,result,sources,savedAt}));
          const data = {format:'spindle-project',version:1,name:project.name,checkpoints};
          downloadArtifact(`${artifactName(project.name,'project')}.spindle.json`, JSON.stringify(data,null,2), 'application/json');
        } else {
          const checkpoint = action === 'latest' ? project.checkpoints[0] : project.checkpoints.find(item => item.id === detail);
          if (!checkpoint) throw Error('Checkpoint is unavailable.');
          if (action === 'markdown') {
            const links = checkpoint.sources.map(({url,title})=>`- ${title}: ${url}`).join('\n');
            const markdown = `# ${checkpoint.title}\n\n${checkpoint.brief}${links ? `\n\n## Sources\n\n${links}` : ''}\n`;
            downloadArtifact(`${artifactName(checkpoint.title,'checkpoint')}.md`,markdown,'text/markdown;charset=utf-8');
          } else if (activate(id,{checkpointId:checkpoint.id,mode:action === 'refine' ? 'result' : 'brief',title:checkpoint.title})) dialog.close();
        }
      }
    } catch (problem) { report(problem); }
    finally { control.disabled = false; }
  }

  return {mount,
    async open(id = activeId(), checkpointId = '') {
      pendingRun = null;
      start();
      try { if (id) await showProject(id, checkpointId); else await showList(); } catch (problem) { report(problem); }
    },
    async capture(runId, id) {
      if (id) return save(id, runId);
      pendingRun = runId;
      start();
      try { await showList(); } catch (problem) { report(problem); }
    },
    async loadName(id) { return id ? (await get()).find(project => project.id === id)?.name ?? '' : ''; },
  };
}
