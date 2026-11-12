export const vaultDialogHTML = `
  <dialog id="vault-dialog" aria-labelledby="vault-title">
    <button class="dialog-close" type="button" aria-label="Close Vault">×</button>
    <h2 id="vault-title">Attach from Vault</h2>
    <p class="help">Choose a document to see its opening excerpts, or search for a specific passage.</p>
    <form id="vault-search-form">
      <label class="field"><span>Vault document</span><select id="vault-document" required></select></label>
      <button class="button quiet" id="vault-more" type="button" hidden>Load more documents</button>
      <label class="field"><span>Find an excerpt</span><input id="vault-query" type="search" maxlength="500" required autocomplete="off"></label>
      <button class="button" type="submit">Search Vault</button>
    </form>
    <p class="help" id="vault-status" role="status"></p>
    <div id="vault-results"></div>
  </dialog>`;

export function bindVaultAttachment({api, dialog, open, attached, onChange}) {
  const form = dialog.querySelector('form');
  const select = dialog.querySelector('#vault-document');
  const more = dialog.querySelector('#vault-more');
  const query = dialog.querySelector('#vault-query');
  const search = form.querySelector('[type="submit"]');
  const status = dialog.querySelector('#vault-status');
  const results = dialog.querySelector('#vault-results');
  const label = attached.querySelector('span');
  let reference = null;
  let nextOffset = null;
  let request = 0;

  function setReference(value) {
    reference = value;
    label.textContent = value ? 'Vault · ' + value.name : '';
    attached.hidden = !value;
    onChange();
  }

  async function loadDocuments(offset) {
    const ticket = ++request;
    more.disabled = search.disabled = true;
    status.textContent = 'Loading Vault documents…';
    try {
      const page = await api('/api/vault/documents?offset=' + offset);
      if (ticket !== request || !dialog.open) return;
      for (const {id, name} of page.documents) {
        const option = new Option(name, id);
        option.dataset.offset = offset;
        select.add(option);
      }
      nextOffset = page.nextOffset;
      more.hidden = nextOffset === null;
      status.textContent = select.options.length > 1 ? '' :
        nextOffset === null ? 'No documents available to preview. Add a document in TiinyOS.' : 'Load more documents to check for available files.';
    } catch (error) {
      if (ticket === request && dialog.open) status.textContent = error.message;
    } finally {
      if (ticket === request) {
        more.disabled = false;
        search.disabled = !select.value;
      }
    }
  }

  open.addEventListener('click', () => {
    select.replaceChildren(new Option('Choose a document…', ''));
    results.replaceChildren();
    more.hidden = true;
    query.value = '';
    nextOffset = null;
    dialog.showModal();
    void loadDocuments(0);
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  attached.querySelector('button').addEventListener('click', () => setReference(null));
  more.addEventListener('click', () => { if (nextOffset !== null) void loadDocuments(nextOffset); });
  select.addEventListener('change', () => {
    request++;
    search.disabled = !select.value;
    more.disabled = false;
    status.textContent = '';
    results.replaceChildren();
    if (select.value) void showExcerpts('');
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!select.value || search.disabled) return;
    void showExcerpts(query.value.trim());
  });

  async function showExcerpts(question) {
    const ticket = ++request;
    const offset = Number(select.selectedOptions[0].dataset.offset);
    const sourceId = select.value;
    search.disabled = more.disabled = true;
    results.replaceChildren();
    status.textContent = question ? 'Searching Vault on your Tiiny…' : 'Loading excerpts from this document…';
    try {
      const {name, excerpts, connectionId, method, searchUnavailable} = await api('/api/vault/search', {offset, sourceId, query: question});
      if (ticket !== request || !dialog.open) return;
      if (!excerpts.length) {
        status.textContent = 'No excerpts available. Try searching for a specific phrase or check that TiinyOS has indexed this file.';
      } else if (method === 'browse') {
        status.textContent = searchUnavailable ? 'Vault search was unavailable. Showing opening excerpts from this document.'
          : question ? 'No matching excerpts. Showing opening excerpts from this document.' : 'Opening excerpts from this document.';
      } else {
        status.textContent = '';
      }
      for (const {text, shortened} of excerpts) {
        const preview = document.createElement('article');
        const excerpt = document.createElement('pre');
        excerpt.textContent = text;
        preview.append(excerpt);
        if (shortened) {
          const note = document.createElement('p');
          note.className = 'help';
          note.textContent = 'Only the text shown here will be attached.';
          preview.append(note);
        }
        const attach = document.createElement('button');
        attach.type = 'button';
        attach.className = 'button primary';
        attach.textContent = 'Attach this excerpt';
        attach.addEventListener('click', () => {
          setReference({name, text, connectionId});
          dialog.close();
        });
        preview.append(attach);
        results.append(preview);
      }
    } catch (error) {
      if (ticket === request && dialog.open) status.textContent = error.message;
    } finally {
      if (ticket === request) search.disabled = more.disabled = false;
    }
  }

  return { get reference() { return reference; }, clear() { setReference(null); } };
}
