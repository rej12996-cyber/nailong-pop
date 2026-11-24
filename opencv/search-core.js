
const DictCore=(()=>{
 const synonyms={'图像配准':'配准','灰度化':'灰度','图片保存':'保存','高斯模糊':'高斯','特征点检测':'特征'};
 function normalizeQuery(value){let q=String(value||'').trim().replace(/^(?:cv2?\.|cv::)/i,'').split('(')[0].trim().toLowerCase();return synonyms[q]||q}
 function prepare(entry){entry._name=entry.name.toLowerCase();entry._compact=entry._name.replace(/[_\s-]/g,'');entry._aliases=(entry.aliases||[]).join(' ').toLowerCase();entry._body=[entry.title,entry.description,entry.category,entry.signature,entry._aliases,(entry.tips||[]).join(' ')].join(' ').toLowerCase();return entry}
 function rank(entry,q){if(!q)return entry.curated?50:1;let score=0;const parts=q.split(/\s+/).filter(Boolean);for(const term of parts){let n=entry._name,c=term.replace(/[_\s-]/g,'');let s=n===term?1000:n.endsWith('.'+term)?850:n.startsWith(term)?650:n.includes(term)?470:entry._compact.includes(c)?400:entry._aliases.includes(term)?330:entry._body.includes(term)?120:0;if(!s)return 0;score+=s}return score+(entry.curated?28:0)}
 function search(entries,query,category='all',kind='all',only=false,favorites=new Set()){let q=normalizeQuery(query);return entries.filter(e=>(category==='all'||(category==='favorites'?favorites.has(e.name):e.category===category))&&(kind==='all'||e.kind===kind)&&(!only||e.curated)).map(e=>({e,score:rank(e,q)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.e.name.localeCompare(b.e.name)).map(x=>x.e)}
 function distance(a,b){const prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){let diagonal=prev[0];prev[0]=i+1;for(let j=0;j<b.length;j++){let old=prev[j+1];prev[j+1]=Math.min(prev[j+1]+1,prev[j]+1,diagonal+(a[i]===b[j]?0:1));diagonal=old}}return prev[b.length]}
 function closest(entries,query){const q=normalizeQuery(query).replace(/_/g,'');if(!q||q.length>50||/[\u3400-\u9fff]/.test(q))return [];return entries.filter(e=>e.curated||e.kind==='function').map(e=>({e,d:distance(q,e._compact)})).filter(x=>x.d<=Math.max(2,Math.floor(q.length*.3))).sort((a,b)=>a.d-b.d||Number(b.e.curated)-Number(a.e.curated)).slice(0,4).map(x=>x.e)}
 return {normalizeQuery,prepare,rank,search,closest};
})();
