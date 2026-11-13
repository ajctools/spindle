export function compareValues(a,b,direction){
  if(a==null)return b==null?0:1;
  if(b==null)return -1;
  const order=typeof a==='number'?a-b:a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  return order*direction;
}

export function sortableHeader(labels){
  return labels.map((label,i)=>`<th scope="col"><button type="button" data-sort-column="${i}">${label}<span aria-hidden="true">↕</span></button></th>`).join('');
}

export function sortTable(body,initial){
  const headers=[...body.closest('table').querySelectorAll('thead button[data-sort-column]')];
  let sort=initial;
  const apply=()=>{
    for(const [i,button] of headers.entries()){
      const active=i===sort?.column;
      if(active)button.parentElement.setAttribute('aria-sort',sort.direction===1?'ascending':'descending');
      else button.parentElement.removeAttribute('aria-sort');
      button.lastElementChild.textContent=active?(sort.direction===1?'↑':'↓'):'↕';
    }
    if(!sort||body.rows.length<2)return;
    const value=row=>{
      const cell=row.cells[sort.column];
      const raw=cell.dataset.sortValue;
      return raw===undefined?cell.textContent.trim():raw===''?null:Number(raw);
    };
    const rows=[...body.rows];
    const sorted=rows.toSorted((a,b)=>compareValues(value(a),value(b),sort.direction));
    if(sorted.some((row,i)=>row!==rows[i]))body.append(...sorted);
  };
  for(const [column,button] of headers.entries()){
    button.onclick=()=>{
      sort={column,direction:sort?.column===column?-sort.direction:column===0?1:-1};
      apply();
    };
  }
  return apply;
}
