/* TMS CARRETAS V1 - navegador + Supabase - sem chave secreta */
(()=>{'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const main=$('#main'), modal=$('#modal');
const state={db:null,user:null,profile:null,page:'dashboard',vehicles:[],drivers:[],trips:[],selected:null,detail:null,tab:'despesas',ctes:[]};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const n=v=>Number(v||0);
const fdate=d=>d?new Date(d).toLocaleString('pt-BR'):'—';
const dtlocal=d=>{let a=d?new Date(d):new Date();return new Date(a.getTime()-a.getTimezoneOffset()*60000).toISOString().slice(0,16)};
const iso=v=>v?new Date(v).toISOString():null;
const gestor=()=>state.profile?.role==='gestor';
const error=e=>{console.error(e);toast((e?.message||String(e)).slice(0,350));};
let toastTimer;function toast(m){const x=$('#toast');x.textContent=m;x.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.classList.remove('show'),6500)}
function title(t,desc='',btn=''){return `<div class="page-head"><div><h2>${esc(t)}</h2><p>${esc(desc)}</p></div><div class="toolbar">${btn}</div></div>`}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function opts(rows,label,placeholder='Selecione...'){return `<option value="">${placeholder}</option>`+rows.map(r=>`<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('')}
function statusTag(s){return `<span class="tag ${s==='Em Aberto'?'open':s==='Finalizada'?'done':'cancel'}">${esc(s)}</span>`}
function tripTitle(v){return `${vehicle(v.veiculo_id)?.placa||'Carreta'} · ${esc(v.origens)} → ${esc(v.destinos)}`}
function vehicle(id){return state.vehicles.find(x=>x.id===id)}
function driver(id){return state.drivers.find(x=>x.id===id)}
function safeName(s){return String(s||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)}
function showModal(html){$('#modal-content').innerHTML=html;modal.showModal()}
function closeModal(){modal.close();$('#modal-content').innerHTML=''}
async function query(table,columns='*',filters){let q=state.db.from(table).select(columns);if(filters)q=filters(q);const {data,error:e}=await q;if(e)throw e;return data||[]}
async function rpc(name,args){const {data,error:e}=await state.db.rpc(name,args);if(e)throw e;return data}
async function insert(table,values){const {error:e}=await state.db.from(table).insert(values);if(e)throw e;toast('Registro salvo com sucesso.');}
async function update(table,values,id){const {error:e}=await state.db.from(table).update(values).eq('id',id);if(e)throw e;toast('Registro atualizado.');}
async function upload(file,trip){if(!file||!file.size)return null;if(file.size>10*1024*1024)throw Error('Comprovante acima de 10 MB.');
 const allowed=['image/jpeg','image/png','image/webp','application/pdf','application/xml','text/xml'];
 if(!allowed.includes(file.type)&&!(/\.xml$/i.test(file.name)))throw Error('Formato de arquivo não aceito.');
 const path=`${state.user.id}/${trip}/${crypto.randomUUID()}_${safeName(file.name)}`;
 const {error:e}=await state.db.storage.from('tms-comprovantes').upload(path,file,{upsert:false,contentType:file.type||'application/xml'});if(e)throw e;return path;
}
async function openFile(path){if(!path)return;const {data,error:e}=await state.db.storage.from('tms-comprovantes').createSignedUrl(path,120);if(e)throw e;window.open(data.signedUrl,'_blank','noopener,noreferrer')}
async function refresh(){const [v,d,t,c]=await Promise.all([query('veiculos'),query('funcionarios'),query('viagens','*',q=>q.order('data_saida',{ascending:false})),query('tms_ctes','*',q=>q.order('created_at',{ascending:false}))]);state.vehicles=v;state.drivers=d;state.trips=gestor()?t:t.filter(x=>x.funcionario_id===state.profile?.funcionario_id);state.ctes=gestor()?c:c.filter(x=>state.trips.some(v=>v.id===x.viagem_id))}
function goto(p){if(!gestor()&&!['motorista','motorista-historico'].includes(p))p='motorista';if(gestor()&&['motorista','motorista-historico'].includes(p))p='dashboard';state.page=p;$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===p));render();window.scrollTo({top:0,behavior:'instant'})}
function render(){switch(state.page){case 'dashboard':return dashboard();case 'viagens':return viagens();case 'despesas':return gastos();case 'fechamento':return fechamento();case 'cadastros':return cadastros();case 'usuarios':return usuarios();case 'motorista':return motoristaHome();case 'motorista-historico':return motoristaHistorico();}}
function dashboard(){let abertas=state.trips.filter(v=>v.status==='Em Aberto');let fim=state.trips.filter(v=>v.status==='Finalizada');
 main.innerHTML=title('Painel de transportes','Viagens, frota e lançamentos em um só lugar.',gestor()?'<button class="primary" id="new-trip">+ Abrir viagem</button>':'')+
 `<div class="grid"><div class="card"><div class="metric-label">Viagens em aberto</div><div class="metric">${abertas.length}</div><div class="metric-note">Em execução</div></div><div class="card"><div class="metric-label">Viagens finalizadas</div><div class="metric">${fim.length}</div><div class="metric-note">No histórico</div></div><div class="card"><div class="metric-label">Carretas disponíveis</div><div class="metric">${state.vehicles.filter(v=>v.status==='Disponível').length}</div><div class="metric-note">Prontas para sair</div></div><div class="card"><div class="metric-label">Frota em manutenção</div><div class="metric">${state.vehicles.filter(v=>v.status==='Manutenção').length}</div></div></div>`+
 `<div class="section card"><div class="row"><h3>Viagens recentes</h3><button class="outline" data-action="navigate" data-target="viagens">Ver todas</button></div>${tripTable(state.trips.slice(0,10))}</div>`;
}
function tripTable(arr){if(!arr.length)return '<div class="empty">Nenhuma viagem cadastrada.</div>';
 return `<div class="tablewrap"><table><thead><tr><th>Carreta</th><th>Motorista</th><th>Rota</th><th>Saída</th><th>Status</th><th></th></tr></thead><tbody>${arr.map(v=>`<tr><td><b>${esc(vehicle(v.veiculo_id)?.placa||'—')}</b></td><td>${esc(driver(v.funcionario_id)?.nome||'—')}</td><td class="wrap">${esc(v.origens)} → ${esc(v.destinos)}</td><td>${fdate(v.data_saida)}</td><td>${statusTag(v.status)}</td><td><button class="outline" data-action="trip" data-id="${v.id}">Detalhes</button></td></tr>`).join('')}</tbody></table></div>`}
function viagens(){main.innerHTML=title('Viagens','Abertura, acompanhamento e fechamento de percursos.',gestor()?'<button class="primary" id="new-trip">+ Abrir viagem</button>':'')+tripTable(state.trips)}
function openTripForm(){const vehicles=state.vehicles.filter(x=>x.status==='Disponível'), drivers=state.drivers.filter(x=>!state.trips.some(v=>v.status==='Em Aberto'&&v.funcionario_id===x.id));
 showModal(`<h2>Abrir nova viagem</h2><p class="help">O sistema impedirá duas viagens simultâneas para a mesma carreta ou motorista.</p><form id="trip-form" class="form-grid">
 <label>Carreta<select name="veiculo_id" required>${opts(vehicles,v=>v.placa+' — '+v.modelo)}</select></label><label>Motorista<select name="funcionario_id" required>${opts(drivers,d=>d.nome)}</select></label>
 <label>Saída<input type="datetime-local" name="data_saida" value="${dtlocal()}" required></label><label>KM inicial<input type="number" name="km_inicial" min="0" step="0.1" required></label>
 <label>Origem<input name="origens" required placeholder="Manaus / AM"></label><label>Destino<input name="destinos" required placeholder="Boa Vista / RR"></label>
 <div class="full form-actions"><button class="primary">Criar viagem</button></div></form>`);
 const select=$('#trip-form [name=veiculo_id]');select.onchange=()=>{$('#trip-form [name=km_inicial]').value=vehicle(select.value)?.km_inicial??0};if(vehicles.length){select.value=vehicles[0].id;select.onchange()};
 $('#trip-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);try{await insert('viagens',{veiculo_id:f.veiculo_id,funcionario_id:f.funcionario_id,data_saida:iso(f.data_saida),origens:f.origens.trim(),destinos:f.destinos.trim(),km_inicial:n(f.km_inicial),created_by:state.user.id});closeModal();await refresh();goto('viagens')}catch(ex){error(ex)}};
}
async function detail(id){
 if(!gestor())return motoristaTrip(id);
 const trip=state.trips.find(v=>v.id===id);if(!trip)return;
 state.selected=id;state.detail=null;
 main.innerHTML=title('Viagem '+(vehicle(trip.veiculo_id)?.placa||''),'Carregando registros...');
 try{
  const [r,d,a,ad,financial]=await Promise.all([
   query('receitas_frete','*',q=>q.eq('viagem_id',id).order('created_at',{ascending:false})),
   query('despesas_viagem','*',q=>q.eq('viagem_id',id).order('data',{ascending:false})),
   query('abastecimentos','*',q=>q.eq('viagem_id',id).order('created_at',{ascending:false})),
   query('adiantamentos','*',q=>q.eq('viagem_id',id).order('data',{ascending:false})),
   rpc('resumo_viagem',{p_viagem_id:id}).then(summary=>({summary,financialError:null})).catch(err=>({summary:null,financialError:err?.message||String(err)}))
  ]);
  state.detail={trip,r,d,a,ad,summary:financial.summary,financialError:financial.financialError,ctes:state.ctes.filter(c=>c.viagem_id===id)};
  renderDetail();
  if(financial.financialError)toast('DRE indisponível: '+financial.financialError);
 }catch(ex){
  error(ex);
  main.innerHTML=title('Viagem '+(vehicle(trip.veiculo_id)?.placa||''),'Não foi possível carregar os registros.',`<button class="secondary" data-action="navigate" data-target="viagens">← Voltar</button><button class="primary" data-action="trip" data-id="${esc(id)}">Tentar novamente</button>`)+`<div class="warning">${esc(ex?.message||String(ex))}</div>`;
 }
}
function renderDetail(){if(!state.detail)return;const {trip:v,r,d,a,ad,summary:s,financialError}=state.detail,open=v.status==='Em Aberto';
 main.innerHTML=title(`Viagem ${vehicle(v.veiculo_id)?.placa||''}`,`${driver(v.funcionario_id)?.nome||''} • ${v.origens} → ${v.destinos}`,`<button class="secondary" id="back-trips">← Voltar</button>${gestor()&&open?'<button class="primary" id="finalize-btn">Finalizar viagem</button>':''}`)+
 (s?`<div class="grid"><div class="card"><div class="metric-label">Receita líquida</div><div class="metric">${brl(s.receita_liquida)}</div></div><div class="card"><div class="metric-label">Despesas operacionais</div><div class="metric">${brl(s.despesas_operacionais)}</div></div><div class="card"><div class="metric-label">Resultado antes da remuneração</div><div class="metric ${n(s.lucro_solicitado)>=0?'money-pos':'money-neg'}">${brl(s.lucro_solicitado)}</div></div><div class="card"><div class="metric-label">Status da viagem</div><div style="margin-top:13px">${statusTag(v.status)}</div><div class="metric-note">${fdate(v.data_saida)}</div></div></div>`:`<div class="warning">O DRE está temporariamente indisponível devido a um erro na função resumo_viagem do Supabase. Os dados financeiros não foram calculados. ${esc(financialError||'')}</div>`)+
 `<div class="tabs">${[['despesas','Despesas'],['abastecimentos','Abastecimentos'],['receitas','Fretes / XML'],['ctes','CT-es'],['adiantamentos','Adiantamentos'],['dre','DRE / Acerto']].map(([id,label])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${label}</button>`).join('')}</div><div id="detail-tab"></div>`;
 $('#back-trips').onclick=()=>goto('viagens');if($('#finalize-btn'))$('#finalize-btn').onclick=finalizeForm;renderTab();
}
function renderTab(){if(!state.detail)return;const {trip:v,r,d,a,ad,summary:s}=state.detail,open=v.status==='Em Aberto';const t=state.tab;$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));const target=$('#detail-tab');
 if(t==='dre'){target.innerHTML=s?dreHTML(s,v):'<div class="warning">O DRE não pode ser exibido até a correção da função resumo_viagem no Supabase. Nenhum valor foi estimado.</div>';return}
  if(t==='ctes'){target.innerHTML=cteSection(v.id);return}
 const canAdd=open&&(gestor()||['despesas','abastecimentos'].includes(t));
 const add=canAdd?`<button class="primary" data-action="add" data-type="${t}">+ Novo lançamento</button>`:'';
 const labels={despesas:'Despesas da viagem',abastecimentos:'Abastecimentos',receitas:'Receitas de frete e DF-e',adiantamentos:'Adiantamentos do motorista'};
 const rows=t==='despesas'?d:t==='abastecimentos'?a:t==='receitas'?r:ad;
 const textItem=x=>t==='despesas'?`${esc(x.categoria)} • ${brl(x.valor)} • ${fdate(x.data)}${x.observacao?' • '+esc(x.observacao):''}`:
 t==='abastecimentos'?`${esc(x.posto_nome)} • ${n(x.litros)} L × ${brl(x.valor_por_litro)} = ${brl(x.valor_total)} • KM ${x.km_no_abastecimento}`:
 t==='receitas'?`${esc(x.tipo_documento)} ${esc(x.numero_nota||'')} • Frete ${brl(x.valor_frete_bruto)} • Impostos ${brl(x.valor_impostos)} ${!x.revisado?'<span class="tag open">Revisar</span>':''}`:
 `${brl(x.valor)} • ${esc(x.forma_pagamento)} • ${esc(x.status_prestacao_contas)}`;
 target.innerHTML=`<div class="card"><div class="row"><h3>${labels[t]}</h3><div class="toolbar">${add}${t==='receitas'&&open&&gestor()?'<button class="outline" data-action="xml">Importar XML</button>':''}</div></div>
 ${t==='despesas'?'<p class="help">Combustível lançado aqui é separado de abastecimentos. Não registre o mesmo cupom nas duas categorias.</p>':''}
 ${rows.length?`<div class="list" style="margin-top:15px">${rows.map(x=>`<div class="item"><div class="row"><div><b>${textItem(x)}</b>${(x.chave_acesso_nfe_cte)?`<p class="mini">Chave: ${esc(x.chave_acesso_nfe_cte)}</p>`:''}</div><div class="toolbar">${x.comprovante_url||x.foto_comprovante?`<button class="outline" data-action="file" data-path="${esc(x.comprovante_url||x.foto_comprovante)}">Comprovante</button>`:''}${t==='receitas'&&gestor()&&open&&!x.revisado?`<button class="outline" data-action="review" data-id="${x.id}">Revisar</button>`:''}</div></div></div>`).join('')}</div>`:'<div class="empty">Nenhum lançamento nesta categoria.</div>'}</div>`;
}
function dreHTML(s,v){const lines=[['Receitas brutas',s.receita_bruta],['(-) Impostos',-s.impostos],['(=) Receitas líquidas',s.receita_liquida],['(-) Despesas lançadas',-s.despesas_lancadas],['(-) Abastecimentos',-s.combustivel],['(=) Resultado antes da remuneração',s.lucro_solicitado],['(-) Comissão do motorista',-s.comissao],['(-) Diárias do motorista',-s.diarias],['(=) Resultado após remuneração',s.resultado_apos_remuneracao]];
 return `<div class="two"><div class="card"><h3>Demonstrativo de Resultado da Viagem</h3><div class="list">${lines.map(([k,val])=>`<div class="row item"><span>${esc(k)}</span><b class="${n(val)<0?'money-neg':''}">${brl(val)}</b></div>`).join('')}</div><p class="help">A fórmula de lucro solicitada é exibida antes da comissão e das diárias. O resultado após remuneração é mostrado separadamente para transparência.</p></div>
 <div class="card"><h3>Acerto com o motorista</h3><div class="list">${[['Adiantamentos',s.adiantamentos],['Gastos pessoais justificados',s.gastos_pessoais],['Saldo dos adiantamentos',s.saldo_adiantamentos],['Comissão',s.comissao],['Diárias ('+s.dias+' dia(s))',s.diarias],['Saldo a pagar (+) / recuperar (-)',s.acerto_a_pagar],['KM rodados',s.km_rodado],['Litros abastecidos',s.litros],['Consumo aparente km/L',s.consumo_kml??'N/D'],['Custo por km',s.custo_km==null?'N/D':brl(s.custo_km)],['Margem antes da remuneração',s.margem_percentual==null?'N/D':s.margem_percentual+'%']].map(([k,val])=>`<div class="row item"><span>${esc(k)}</span><b>${typeof val==='number'?(['Adiantamentos','Gastos pessoais justificados','Saldo dos adiantamentos','Comissão','Saldo a pagar (+) / recuperar (-)'].includes(k)||k.startsWith('Diárias')?brl(val):val.toLocaleString('pt-BR')):esc(val)}</b></div>`).join('')}</div><p class="help">Acerto = comissão + diárias − (adiantamentos − gastos pessoais justificados). Gastos pessoais são despesas operacionais neste modelo. O consumo com litros abastecidos é apenas indicativo e depende de tanques comparáveis no início e no fim.</p><button class="secondary" onclick="window.print()">Imprimir DRE</button></div></div>`}
function moneyInput(name,title,extra=''){return `<label>${title}<input type="number" min="0" step="0.01" name="${name}" ${extra} required></label>`}
function addForm(type){if(!state.detail){toast('Abra a viagem antes de criar um lançamento.');return;}const {trip:v}=state.detail;if(v.status!=='Em Aberto')return;let body='';
 if(type==='despesas')body=`<label>Categoria<select name="categoria" required>${['Pedagio','Gastos_Pessoais_Motorista','Manutencao_Urgente','Chapa_Descarga','Outros','Combustivel'].map(x=>`<option>${x}</option>`).join('')}</select></label>${moneyInput('valor','Valor (R$)')}<label>Data<input name="data" type="datetime-local" value="${dtlocal()}" required></label><label class="full">Observação<textarea name="observacao"></textarea></label><label class="full">Comprovante (foto/PDF)<input type="file" name="arquivo" accept="image/*,.pdf"></label><div class="warning full">Se este gasto for um abastecimento, prefira a aba Abastecimentos para registrar litros, preço e quilometragem. Nunca duplique o mesmo cupom.</div>`;
 if(type==='abastecimentos')body=`<label>Posto<input name="posto_nome" required></label>${moneyInput('litros','Litros','step="0.001" min="0.001"')}${moneyInput('valor_por_litro','Valor por litro (R$)','step="0.0001" min="0.0001"')}<label>KM no abastecimento<input type="number" step="0.1" name="km_no_abastecimento" min="${n(v.km_inicial)}" required></label><label class="full">Foto do comprovante<input name="arquivo" type="file" accept="image/*,.pdf"></label>`;
 if(type==='receitas')body=`<label>Número do documento<input name="numero_nota" required></label><label>Chave de acesso (opcional)<input name="chave_acesso_nfe_cte" maxlength="44"></label>${moneyInput('valor_frete_bruto','Valor do frete bruto (R$)')}${moneyInput('valor_impostos','Impostos incidentes (R$)')}<label>Peso (kg)<input name="peso_kg" type="number" min="0" step="0.001"></label><label>Mercadoria<input name="descricao_mercadoria"></label>`;
 if(type==='adiantamentos')body=`${moneyInput('valor','Valor adiantado (R$)')}<label>Data<input type="datetime-local" name="data" value="${dtlocal()}" required></label><label>Pagamento<select name="forma_pagamento"><option>PIX</option><option>Dinheiro</option></select></label><label>Prestação<select name="status_prestacao_contas"><option>Pendente</option><option>Prestado</option><option>Conferido</option></select></label>`;
 showModal(`<h2>Novo registro • ${esc(type)}</h2><form id="record-form" class="form-grid">${body}<div class="full form-actions"><button class="primary">Salvar registro</button></div></form>`);
 $('#record-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);const file=e.currentTarget.querySelector('[name=arquivo]')?.files[0];let path=null;try{
 if(file)path=await upload(file,v.id);
 const base={viagem_id:v.id};let row;
 if(type==='despesas')row={...base,categoria:f.categoria,data:iso(f.data),valor:n(f.valor),observacao:f.observacao||null,comprovante_url:path,created_by:state.user.id};
 if(type==='abastecimentos')row={...base,posto_nome:f.posto_nome.trim(),litros:n(f.litros),valor_por_litro:n(f.valor_por_litro),km_no_abastecimento:n(f.km_no_abastecimento),foto_comprovante:path,created_by:state.user.id};
 if(type==='receitas')row={...base,tipo_documento:'Manual',numero_nota:f.numero_nota.trim(),chave_acesso_nfe_cte:f.chave_acesso_nfe_cte||null,valor_frete_bruto:n(f.valor_frete_bruto),valor_impostos:n(f.valor_impostos),peso_kg:f.peso_kg? n(f.peso_kg):null,descricao_mercadoria:f.descricao_mercadoria||null,revisado:true};
 if(type==='adiantamentos')row={...base,valor:n(f.valor),data:iso(f.data),forma_pagamento:f.forma_pagamento,status_prestacao_contas:f.status_prestacao_contas};
 await insert(({despesas:'despesas_viagem',abastecimentos:'abastecimentos',receitas:'receitas_frete',adiantamentos:'adiantamentos'})[type],row);closeModal();await detail(v.id)
 }catch(ex){error(ex)}};
}
function xmlValue(root,names){for(const name of names){const e=[...root.getElementsByTagName('*')].find(x=>x.localName===name);if(e?.textContent?.trim())return e.textContent.trim()}return ''}
function xmlChild(root,name){return [...root.getElementsByTagName('*')].find(x=>x.localName===name)}
function xmlDocInfo(raw){if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('XML com DTD/entidades não é aceito');const doc=new DOMParser().parseFromString(raw,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('XML inválido');
 const infN=xmlChild(doc,'infNFe'),infC=xmlChild(doc,'infCte');if(!infN&&!infC)throw Error('Somente NF-e ou CT-e suportados');const node=infN||infC,cte=!!infC;
 const ide=xmlChild(node,'ide'), emit=xmlChild(node,'emit'), dest=xmlChild(node,'dest')||xmlChild(node,'rem'), totals=xmlChild(node,cte?'vPrest':'ICMSTot')||node;
 let key=(node.getAttribute('Id')||'').replace(/^(NFe|CTe)/i,'');if(!/^\d{44}$/.test(key)){const p=xmlChild(doc,cte?'protCTe':'protNFe');key=xmlValue(p||doc,['chCTe','chNFe'])}if(!/^\d{44}$/.test(key))throw Error('Chave de acesso de 44 dígitos não encontrada');
 const brutoDoc=n(xmlValue(totals,cte?['vTPrest']:['vNF']));const cteTax=xmlValue(xmlChild(node,'ICMS')||node,['vICMS']);const tax=cte&&cteTax?n(cteTax):0;
 const carga=xmlChild(node,cte?'infCarga':'transp')||node;
 let peso=xmlValue(carga,cte?['qCarga']:['pesoB']);
 if(cte){const u=[...carga.getElementsByTagName('*')].find(x=>x.localName==='infQ'&&xmlValue(x,['cUnid'])==='01');if(u)peso=xmlValue(u,['qCarga'])||peso}
 const placas=[...node.getElementsByTagName('*')].filter(x=>x.localName==='placa').map(x=>x.textContent.trim().replace(/[^A-Z0-9]/gi,'').toUpperCase());
 return {tipo:cte?'CTe':'NFe',key,numero:xmlValue(ide,['nCT','nNF']),emitente:xmlValue(emit||node,['xNome']),destinatario:xmlValue(dest||node,['xNome']),documento:brutoDoc,frete:cte?brutoDoc:0,impostos:tax,peso:peso&&Number.isFinite(Number(peso))?Number(peso):null,mercadoria:xmlValue(carga,['proPred','xProd']),placas,raw};
}
function importXmlForm(){if(!state.detail){toast('Abra a viagem antes de importar XML.');return;}const v=state.detail.trip;showModal(`<h2>Importar XML DF-e</h2><p class="warning">XML não é consultado nem validado online na SEFAZ. NF-e representa mercadoria: seu valor total NÃO vira receita de frete. CT-e pode sugerir valor do serviço, sujeito à revisão obrigatória.</p><form id="xml-form" class="form-grid"><label class="full">XML NF-e ou CT-e (máx. 2 MB)<input name="xml" type="file" accept=".xml,application/xml,text/xml" required></label><div id="xml-preview" class="full"></div><div class="full form-actions"><button class="primary">Importar como pendente de revisão</button></div></form>`);
 let info=null;$('#xml-form [name=xml]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('XML maior que 2 MB');info=xmlDocInfo(await file.text());$('#xml-preview').innerHTML=`<div class="item"><b>${info.tipo} ${esc(info.numero)} · ${esc(info.key)}</b><p>Emitente: ${esc(info.emitente)}<br>Destinatário: ${esc(info.destinatario)}<br>Valor documento: ${brl(info.documento)}<br>Frete sugerido: ${brl(info.frete)}<br>ICMS identificado: ${brl(info.impostos)}</p>${info.placas.length?`<p>Placas presentes: ${esc(info.placas.join(', '))}</p>`:''}<p class="help">Vinculando explicitamente à viagem ${esc(vehicle(v.veiculo_id)?.placa)}. O usuário deve confirmar vínculo e valor antes de fechar.</p></div>`}catch(ex){info=null;error(ex)}};
 $('#xml-form').onsubmit=async e=>{e.preventDefault();try{if(!info)throw Error('Selecione um XML válido.');if(state.ctes.some(c=>c.chave_acesso===info.key))throw Error('Este CT-e já foi cadastrado no módulo CT-e. A receita já está vinculada ao DRE.');if(state.detail.r.some(r=>r.chave_acesso_nfe_cte===info.key))throw Error('Esta chave já existe nos fretes da viagem.');const row={viagem_id:v.id,chave_acesso_nfe_cte:info.key,numero_nota:info.numero,tipo_documento:info.tipo,valor_frete_bruto:info.frete,valor_impostos:Math.min(info.impostos,info.frete),peso_kg:info.peso,descricao_mercadoria:info.mercadoria||null,emitente:info.emitente||null,destinatario:info.destinatario||null,valor_documento:info.documento,xml_raw_data:info.raw,revisado:false};await insert('receitas_frete',row);closeModal();await detail(v.id)}catch(ex){error(ex)}};
}
function reviewForm(id){const v=state.detail.trip,x=state.detail.r.find(x=>x.id===id);if(!x)return;showModal(`<h2>Revisar receita ${esc(x.numero_nota||'')}</h2><p class="help">Confira o documento original, a placa/viagem, os impostos e o valor que realmente corresponde ao frete. Não presuma PIS/COFINS do XML.</p><form id="review-form" class="form-grid">${moneyInput('valor_frete_bruto','Frete bruto (R$)',`value="${n(x.valor_frete_bruto)}"`)}${moneyInput('valor_impostos','Total de impostos do frete (R$)',`value="${n(x.valor_impostos)}"`)}<label>Mercadoria<input name="descricao_mercadoria" value="${esc(x.descricao_mercadoria||'')}"></label><label>Documento<input disabled value="${esc(x.chave_acesso_nfe_cte||x.numero_nota)}"></label><div class="full form-actions"><button class="primary">Confirmar revisão</button></div></form>`);
 $('#review-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);if(n(f.valor_impostos)>n(f.valor_frete_bruto)){toast('Impostos não podem superar o frete.');return}try{await update('receitas_frete',{valor_frete_bruto:n(f.valor_frete_bruto),valor_impostos:n(f.valor_impostos),descricao_mercadoria:f.descricao_mercadoria,revisado:true},id);closeModal();await detail(v.id)}catch(ex){error(ex)}};
}
function finalizeForm(){if(!state.detail?.summary){toast('Corrija o DRE antes de finalizar a viagem.');return;}const v=state.detail.trip;if(!gestor())return;showModal(`<h2>Fechamento da viagem</h2><p class="warning">Esta operação é definitiva: novos lançamentos e edições ficam bloqueados. Confirme todos os gastos, XML e abastecimentos antes de prosseguir.</p><form id="final-form" class="form-grid"><label>KM final<input type="number" min="${n(v.km_inicial)}" step="0.1" name="km_final" required></label><label>Data de chegada<input type="datetime-local" name="data_chegada" value="${dtlocal()}" required></label><label class="full">Confirmação<select name="confirm" required><option value="">Selecione...</option><option value="SIM">Conferi os lançamentos e desejo finalizar</option></select></label><div class="full form-actions"><button class="danger">Finalizar definitivamente</button></div></form>`);
 $('#final-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);if(f.confirm!=='SIM')return;try{await rpc('finalizar_viagem',{p_viagem_id:v.id,p_km_final:n(f.km_final),p_data_chegada:iso(f.data_chegada)});closeModal();await refresh();state.tab='dre';await detail(v.id);toast('Viagem finalizada e DRE apurada.')}catch(ex){error(ex)}};
}
function gastos(){const open=state.trips.filter(x=>x.status==='Em Aberto');main.innerHTML=title('Lançamento rápido','Motorista: selecione sua viagem para registrar gastos e abastecimentos.')+
 `<div class="grid">${open.map(v=>`<div class="card"><div class="row"><b>${esc(vehicle(v.veiculo_id)?.placa||'Carreta')}</b>${statusTag(v.status)}</div><p>${esc(v.origens)} → ${esc(v.destinos)}</p><p class="mini">${esc(driver(v.funcionario_id)?.nome)}</p><div class="toolbar"><button class="primary" data-action="quick" data-type="despesas" data-id="${v.id}">+ Gasto</button><button class="secondary" data-action="quick" data-type="abastecimentos" data-id="${v.id}">+ Abastecimento</button></div></div>`).join('')||'<div class="card">Não há viagens em aberto para este usuário.</div>'}</div>`}
function fechamento(){main.innerHTML=title('Fechamento e DRE','CT-es por viagem, receitas e acertos. Origem e destino são individuais por CT-e.',gestor()&&state.trips.some(v=>v.status==='Em Aberto')?'<button class="primary" data-action="new-cte">+ Cadastrar CT-e</button>':'')+cteSection(null)+`<div class="section">${tripTable(state.trips)}</div>`}
// CT-e: cadastro manual, vinculado à viagem e à receita do DRE.
const cteFields=[
 ['identificacao','Identificação do documento',[
  ['serie','Série','text'],['modelo','Modelo','text'],['emissao','Data de emissão','datetime-local'],['cfop','CFOP','text'],['natureza','Natureza da prestação','text'],['modal','Modal','select:Rodoviário|Aéreo|Aquaviário|Ferroviário|Dutoviário|Multimodal'],['tipo_servico','Tipo de serviço','text'],['protocolo','Protocolo de autorização','text']]],
 ['participantes','Participantes',[
  ['emitente','Emitente (razão social)','text'],['emitente_doc','CNPJ/CPF emitente','text'],['remetente','Remetente','text'],['remetente_doc','CNPJ/CPF remetente','text'],['destinatario','Destinatário','text'],['destinatario_doc','CNPJ/CPF destinatário','text'],['tomador','Tomador do serviço','text'],['tomador_doc','CNPJ/CPF tomador','text'],['expedidor','Expedidor','text'],['recebedor','Recebedor','text']]],
 ['trajeto','Origem e destino deste CT-e',[
  ['origem_municipio','Município de origem','text'],['origem_uf','UF origem','text'],['origem_local','Local de coleta / endereço','text'],['destino_municipio','Município de destino','text'],['destino_uf','UF destino','text'],['destino_local','Local de entrega / endereço','text']]],
 ['carga','Carga e documentos vinculados',[
  ['produto','Produto predominante','text'],['peso','Peso (kg)','number'],['quantidade','Quantidade de carga','number'],['unidade','Unidade de medida','text'],['valor_carga','Valor da carga (R$)','number'],['notas','NF-es vinculadas (números/chaves)','textarea'],['observacoes','Observações','textarea']]],
 ['financeiro','Componentes do frete e tributos',[
  ['pedagio','Pedágio (R$)','number'],['outros_componentes','Outros componentes (R$)','number'],['base_icms','Base de cálculo ICMS (R$)','number'],['aliquota_icms','Alíquota ICMS (%)','number'],['icms','ICMS destacado (R$)','number'],['situacao_tributaria','CST / situação tributária','text']]]
];
function cteField([key,label,type]){let required=['origem_municipio','origem_uf','destino_municipio','destino_uf'].includes(key)?' required':'';let control=type==='textarea'?`<textarea name="${key}" rows="2"></textarea>`:type.startsWith('select:')?`<select name="${key}">${type.slice(7).split('|').map(v=>`<option>${esc(v)}</option>`).join('')}</select>`:`<input name="${key}" type="${type}" ${type==='number'?'min="0" step="any"':''} ${key.endsWith('_uf')?'maxlength="2" pattern="[A-Za-z]{2}"':''}${required}>`;return `<label>${esc(label)}${control}</label>`}
function cteRoute(c){let d=c.dados||{};return `${esc(d.origem_municipio||'—')}/${esc(d.origem_uf||'—')} → ${esc(d.destino_municipio||'—')}/${esc(d.destino_uf||'—')}`}
function cteSection(tripId){let rows=state.ctes.filter(c=>!tripId||c.viagem_id===tripId);let v=tripId?state.trips.find(v=>v.id===tripId):null;let canAdd=gestor()&&(tripId?v?.status==='Em Aberto':state.trips.some(x=>x.status==='Em Aberto'));return `<div class="card cte-section"><div class="row"><h3>CT-es cadastrados (${rows.length})</h3>${canAdd?`<button class="primary" data-action="new-cte" ${tripId?`data-trip="${esc(tripId)}"`:''}>+ Novo CT-e</button>`:''}</div><p class="help">Os valores vinculados ao DRE são lançados uma única vez, na receita de frete de cada CT-e.</p><div class="cte-list">${rows.map(c=>`<article class="item cte-card"><div class="row"><div><b>CT-e nº ${esc(c.numero)} — Série ${esc(c.dados?.serie||'—')}</b><p>${cteRoute(c)}</p><p class="mini">Frete ${brl(c.valor_frete_bruto)} • Emissão ${esc(c.dados?.emissao?new Date(c.dados.emissao).toLocaleDateString('pt-BR'):'—')} • Viagem ${esc(vehicle(state.trips.find(v=>v.id===c.viagem_id)?.veiculo_id)?.placa||'—')}</p></div><button class="outline" data-action="view-cte" data-id="${esc(c.id)}">Visualizar CT-e</button></div><div class="cte-key"><small>Chave de acesso: <code>${esc(c.chave_acesso)}</code></small><button class="outline" data-action="cte-copy" data-key="${esc(c.chave_acesso)}">Copiar chave</button></div></article>`).join('')||'<div class="empty">Nenhum CT-e cadastrado.</div>'}</div></div>`}
function cteForm(tripId=''){
 if(!gestor())return toast('Somente gestor pode cadastrar CT-es.');
 const trips=state.trips.filter(v=>v.status==='Em Aberto');if(!trips.length)return toast('Cadastre ou abra uma viagem primeiro.');
 const sel=tripId&&trips.some(v=>v.id===tripId)?tripId:trips[0].id;
 const basic=`<label>Viagem vinculada<select name="viagem_id" required>${trips.map(v=>`<option value="${esc(v.id)}" ${v.id===sel?'selected':''}>${esc(vehicle(v.veiculo_id)?.placa||'Carreta')} — ${esc(v.origens)} → ${esc(v.destinos)}</option>`).join('')}</select></label><label>Número do CT-e<input name="numero" required maxlength="30"></label><label class="full">Chave de acesso (44 dígitos)<input name="chave_acesso" inputmode="numeric" pattern="[0-9]{44}" minlength="44" maxlength="44" required placeholder="Somente números"></label><label>Valor bruto do frete (R$)<input name="valor_frete_bruto" type="number" min="0" step="0.01" required></label><label>Impostos considerados no DRE (R$)<input name="valor_impostos" type="number" min="0" step="0.01" value="0" required></label>`;
 const sections=cteFields.map(([key,title,fields])=>`<fieldset class="full cte-fieldset"><legend>${esc(title)}</legend><div class="form-grid">${fields.map(cteField).join('')}</div></fieldset>`).join('');
 showModal(`<h2>Cadastrar CT-e manualmente</h2><p class="help">Cada CT-e pode ter origem e destino diferentes da rota geral da viagem. O lançamento financeiro será criado automaticamente uma única vez.</p><form id="cte-form" class="form-grid">${basic}${sections}<fieldset class="full cte-fieldset"><legend>Arquivos do documento</legend><div class="form-grid"><label>PDF do DACTE / CT-e (obrigatório)<input type="file" name="pdf" accept=".pdf,application/pdf" required></label><label>XML do CT-e (opcional)<input type="file" name="xml" accept=".xml,application/xml,text/xml"></label></div></fieldset><div class="full form-actions"><button class="primary" type="submit">Salvar CT-e e anexos</button></div></form>`);
 $('#cte-form').onsubmit=async e=>{e.preventDefault();let form=e.currentTarget,submit=form.querySelector('[type=submit]');submit.disabled=true;let uploaded=[];try{
 const f=formData(form);let key=String(f.chave_acesso).replace(/\s/g,'');if(!/^\d{44}$/.test(key))throw Error('A chave precisa conter exatamente 44 dígitos.');
 const bruto=Number(f.valor_frete_bruto),tax=Number(f.valor_impostos);if(!Number.isFinite(bruto)||bruto<0||!Number.isFinite(tax)||tax<0||tax>bruto)throw Error('Confira os valores de frete e impostos.');
 if(state.ctes.some(x=>x.chave_acesso===key))throw Error('Essa chave de acesso já está cadastrada.');
 const pdf=form.elements.pdf.files[0],xml=form.elements.xml.files[0];if(!pdf||pdf.size>15*1024*1024||pdf.size<1||!(/\.pdf$/i.test(pdf.name))||pdf.type&&pdf.type!=='application/pdf')throw Error('Anexe um PDF válido de até 15 MB.');
 if(xml&&(xml.size>5*1024*1024||xml.size<1||!(/\.xml$/i.test(xml.name))))throw Error('XML deve ter até 5 MB.');
 // Upload precede o registro: caso falhe a gravação, os arquivos novos são removidos.
 const put=async(file,type)=>{const path=`${f.viagem_id}/${crypto.randomUUID()}.${type}`;const {error:e}=await state.db.storage.from('tms-cte').upload(path,file,{upsert:false,contentType:type==='pdf'?'application/pdf':'application/xml'});if(e)throw e;uploaded.push(path);return path};
 const pdf_path=await put(pdf,'pdf'),xml_path=xml?await put(xml,'xml'):null;
 const dados={};for(const [section,_,fields] of cteFields)for(const [field,,type] of fields)dados[field]=f[field]||'';
 const payload={viagem_id:f.viagem_id,numero:String(f.numero).trim(),chave_acesso:key,valor_frete_bruto:bruto,valor_impostos:tax,pdf_path,xml_path,dados};
 await rpc('tms_registrar_cte',{p_registro:payload});uploaded=[];closeModal();await refresh();if(state.page==='fechamento')fechamento();else await detail(f.viagem_id);toast('CT-e cadastrado com documento e receita vinculada.');
 }catch(ex){if(uploaded.length){const {error:cleanupError}=await state.db.storage.from('tms-cte').remove(uploaded);if(cleanupError)console.warn('Falha ao remover upload temporário',cleanupError)}error(ex)}finally{submit.disabled=false}};
}
function cteView(id){const c=state.ctes.find(x=>x.id===id);if(!c)return toast('CT-e não encontrado.');let d=c.dados||{};let sections=cteFields.map(([_,title,fields])=>`<section class="cte-view-group"><h3>${esc(title)}</h3><div class="cte-view-grid">${fields.map(([k,label])=>`<div><small>${esc(label)}</small><p>${esc(d[k]||'—')}</p></div>`).join('')}</div></section>`).join('');
 showModal(`<div class="cte-view"><h2>CT-e nº ${esc(c.numero)}</h2><p class="help">Cadastro manual — os dados não foram validados na SEFAZ.</p><div class="cte-view-group"><h3>Identificação e DRE</h3><div class="cte-view-grid"><div><small>Chave de acesso</small><p class="cte-break">${esc(c.chave_acesso)}</p></div><div><small>Viagem</small><p>${esc(vehicle(state.trips.find(v=>v.id===c.viagem_id)?.veiculo_id)?.placa||'—')}</p></div><div><small>Frete bruto</small><p>${brl(c.valor_frete_bruto)}</p></div><div><small>Impostos no DRE</small><p>${brl(c.valor_impostos)}</p></div><div><small>Receita vinculada</small><p>${esc(c.receita_id||'—')}</p></div><div><small>Cadastrado em</small><p>${fdate(c.created_at)}</p></div></div></div>${sections}<div class="cte-view-group"><h3>Documentos anexados</h3><div class="toolbar"><button class="primary" data-action="cte-file" data-path="${esc(c.pdf_path)}">Abrir PDF do CT-e</button>${c.xml_path?`<button class="outline" data-action="cte-file" data-path="${esc(c.xml_path)}">Abrir XML</button>`:''}<button class="outline" data-action="cte-copy" data-key="${esc(c.chave_acesso)}">Copiar chave</button></div></div></div>`);
}
async function cteOpenFile(path){if(!path)return;const {data,error:e}=await state.db.storage.from('tms-cte').createSignedUrl(path,120);if(e)throw e;window.open(data.signedUrl,'_blank','noopener,noreferrer')}

// ===== MOTORISTA V1.2 | integrado ao TMS existente =====
function configureMotoristaNav(){
 const side=$('.sidebar'), mobile=$('.mobile-nav');
 if(!side.querySelector('[data-page="motorista"]')){
  const home=document.createElement('button');home.dataset.page='motorista';home.textContent='🚛 Minha Viagem';home.className='driver-only';side.insertBefore(home,side.firstChild);
  const hist=document.createElement('button');hist.dataset.page='motorista-historico';hist.textContent='📋 Meu Histórico';hist.className='driver-only';side.insertBefore(hist,home.nextSibling);
 }
 if(!mobile.querySelector('[data-page="motorista"]')){
  mobile.insertAdjacentHTML('afterbegin','<button class="driver-only" data-page="motorista">Minha viagem</button><button class="driver-only" data-page="motorista-historico">Histórico</button>');
 }
 for(const b of document.querySelectorAll('.sidebar [data-page],.mobile-nav [data-page]')){
  const driverPage=['motorista','motorista-historico'].includes(b.dataset.page);
  b.hidden=gestor()?driverPage:!driverPage;
  b.style.display=b.hidden?'none':'';
 }
}
function minhaViagem(id){return state.trips.find(v=>v.id===id&&v.funcionario_id===state.profile?.funcionario_id)}
function motoristaHome(){
 const abertas=state.trips.filter(v=>v.status==='Em Aberto');
 const ultimas=state.trips.filter(v=>v.status!=='Em Aberto');
 const nome=state.drivers.find(d=>d.id===state.profile.funcionario_id)?.nome || 'Motorista';
 main.innerHTML=title('Minha Viagem',`Bem-vindo, ${nome}. Acompanhe sua rota e seus lançamentos.`)+
 (abertas.length?abertas.map(v=>`<article class="card mt-hero"><div class="row"><strong>VIAGEM EM ANDAMENTO</strong>${statusTag(v.status)}</div><h3>${esc(v.origens)} → ${esc(v.destinos)}</h3><div class="mt-metrics"><div><small>Veículo</small><b>${esc(vehicle(v.veiculo_id)?.placa||'—')}</b></div><div><small>Saída</small><b>${fdate(v.data_saida)}</b></div><div><small>KM inicial</small><b>${n(v.km_inicial).toLocaleString('pt-BR')}</b></div></div><div class="mt-actions"><button class="primary" data-action="motorista-trip" data-id="${esc(v.id)}">Abrir minha viagem</button><button class="secondary" data-action="motorista-add" data-type="despesas" data-id="${esc(v.id)}">+ Gasto</button><button class="secondary" data-action="motorista-add" data-type="abastecimentos" data-id="${esc(v.id)}">+ Abastecimento</button></div></article>`).join(''):'<div class="card empty">Nenhuma viagem em aberto para seu cadastro. Quando o gestor abrir uma viagem para você, ela aparecerá aqui.</div>')+
 (ultimas.length?`<div class="section card"><div class="row"><h3>Viagens anteriores</h3><button class="outline" data-action="navigate" data-target="motorista-historico">Ver histórico</button></div>${motoristaHistoricoHTML(ultimas.slice(0,3))}</div>`:'');
}
function motoristaHistoricoHTML(rows){return `<div class="mt-list">${rows.map(v=>`<div class="item mt-list-item"><div><b>${esc(v.origens)} → ${esc(v.destinos)}</b><p class="mini">${esc(vehicle(v.veiculo_id)?.placa||'Carreta')} • ${fdate(v.data_saida)} • ${esc(v.status)}</p></div><button class="outline" data-action="motorista-trip" data-id="${esc(v.id)}">Consultar</button></div>`).join('')}</div>`}
function motoristaHistorico(){const rows=state.trips.filter(v=>v.status!=='Em Aberto');main.innerHTML=title('Meu Histórico','Consulte seus percursos encerrados e respectivos documentos.')+(rows.length?`<div class="card">${motoristaHistoricoHTML(rows)}</div>`:'<div class="card empty">Nenhuma viagem finalizada.</div>')}
async function motoristaTrip(id){
 const v=minhaViagem(id);if(!v){toast('Viagem não disponível para este motorista.');return goto('motorista')}
 state.motoristaSelected=id;
 main.innerHTML=title('Minha Viagem','Carregando gastos, abastecimentos e CT-es...');
 try{
  const [d,a]=await Promise.all([
   query('despesas_viagem','*',q=>q.eq('viagem_id',id).order('data',{ascending:false})),
   query('abastecimentos','*',q=>q.eq('viagem_id',id).order('created_at',{ascending:false}))
  ]);
  if(!minhaViagem(id))throw Error('Acesso à viagem não autorizado.');
  state.driverDetail={trip:v,d,a,ctes:state.ctes.filter(c=>c.viagem_id===id)};
  motoristaRenderDetail();
 }catch(ex){state.driverDetail=null;error(ex);main.innerHTML=title('Minha Viagem','Falha ao carregar os registros.',`<button class="secondary" data-action="navigate" data-target="motorista">← Voltar</button><button class="outline" data-action="motorista-trip" data-id="${esc(id)}">Tentar novamente</button>`)+`<div class="warning">${esc(ex?.message||String(ex))}</div>`}
}
function motoristaRenderDetail(){
 const det=state.driverDetail;if(!det)return;const {trip:v,d,a,ctes}=det,open=v.status==='Em Aberto';
 const totalGastos=d.reduce((s,x)=>s+n(x.valor),0),totalAbast=a.reduce((s,x)=>s+n(x.valor_total),0);
 main.innerHTML=title('Minha Viagem',`${esc(vehicle(v.veiculo_id)?.placa||'Carreta')} • ${v.origens} → ${v.destinos}`,`<button class="outline" data-action="navigate" data-target="motorista">← Voltar</button>`)+
 `<div class="card mt-hero"><div class="row"><h3>Dados da viagem</h3>${statusTag(v.status)}</div><div class="mt-metrics"><div><small>Saída</small><b>${fdate(v.data_saida)}</b></div><div><small>KM inicial</small><b>${n(v.km_inicial).toLocaleString('pt-BR')}</b></div><div><small>Chegada</small><b>${fdate(v.data_chegada)}</b></div></div>${open?`<div class="mt-actions"><button class="primary" data-action="motorista-add" data-type="despesas" data-id="${esc(v.id)}">+ Registrar gasto</button><button class="secondary" data-action="motorista-add" data-type="abastecimentos" data-id="${esc(v.id)}">+ Abastecimento</button></div>`:'<p class="help">Viagem finalizada: lançamentos bloqueados para preservar o histórico.</p>'}</div>`+
 `<div class="mt-metrics mt-summary"><div class="card"><small>Gastos registrados</small><b>${brl(totalGastos)}</b></div><div class="card"><small>Abastecimentos</small><b>${brl(totalAbast)}</b></div><div class="card"><small>CT-es vinculados</small><b>${ctes.length}</b></div></div>`+
 `<section class="card section"><h3>📄 CT-es da viagem</h3><p class="help">Documentos cadastrados pelo gestor e vinculados ao seu percurso.</p><div class="mt-list">${ctes.map(c=>`<div class="item mt-list-item"><div><b>CT-e ${esc(c.numero)}</b><p class="mini">${cteRoute(c)}</p><p class="mini mt-key">${esc(c.chave_acesso)}</p></div><div class="toolbar"><button class="outline" data-action="motorista-cte" data-id="${esc(c.id)}">Visualizar</button><button class="outline" data-action="cte-copy" data-key="${esc(c.chave_acesso)}">Copiar chave</button></div></div>`).join('')||'<div class="empty">Nenhum CT-e vinculado ainda.</div>'}</div></section>`+
 `<section class="card section"><h3>🧾 Despesas registradas</h3><div class="mt-list">${d.map(x=>`<div class="item mt-list-item"><div><b>${esc(x.categoria?.replaceAll('_',' ')||'Gasto')} · ${brl(x.valor)}</b><p class="mini">${fdate(x.data)}${x.observacao?' • '+esc(x.observacao):''}</p></div>${x.comprovante_url?`<button class="outline" data-action="file" data-path="${esc(x.comprovante_url)}">Comprovante</button>`:''}</div>`).join('')||'<div class="empty">Nenhuma despesa registrada.</div>'}</div></section>`+
 `<section class="card section"><h3>⛽ Abastecimentos registrados</h3><div class="mt-list">${a.map(x=>`<div class="item mt-list-item"><div><b>${esc(x.posto_nome||'Posto')} · ${brl(x.valor_total)}</b><p class="mini">${n(x.litros).toLocaleString('pt-BR')} L • KM ${n(x.km_no_abastecimento).toLocaleString('pt-BR')}</p></div>${x.foto_comprovante?`<button class="outline" data-action="file" data-path="${esc(x.foto_comprovante)}">Comprovante</button>`:''}</div>`).join('')||'<div class="empty">Nenhum abastecimento registrado.</div>'}</div></section>`;
}
function motoristaCteView(id){
 const c=state.ctes.find(x=>x.id===id&&minhaViagem(x.viagem_id));if(!c)return toast('Documento não disponível para seu perfil.');
 const d=c.dados||{};
 const fmt=(k)=>esc(d[k]??'—');
 showModal(`<div class="cte-view"><h2>CT-e nº ${esc(c.numero)}</h2><p class="help">Dados fornecidos pelo gestor; consulte o documento original para conferência.</p><div class="cte-view-group"><h3>Identificação e rota</h3><div class="cte-view-grid"><div><small>Número</small><p>${esc(c.numero)}</p></div><div><small>Chave de acesso</small><p class="cte-break">${esc(c.chave_acesso)}</p></div><div><small>Origem</small><p>${fmt('origem_municipio')} / ${fmt('origem_uf')}</p></div><div><small>Destino</small><p>${fmt('destino_municipio')} / ${fmt('destino_uf')}</p></div><div><small>Produto</small><p>${fmt('produto')}</p></div><div><small>Peso</small><p>${fmt('peso')}</p></div></div></div><div class="cte-view-group"><h3>Anexos</h3><div class="toolbar"><button class="primary" data-action="cte-file" data-path="${esc(c.pdf_path)}">Abrir PDF</button>${c.xml_path?`<button class="outline" data-action="cte-file" data-path="${esc(c.xml_path)}">Abrir XML</button>`:''}<button class="outline" data-action="cte-copy" data-key="${esc(c.chave_acesso)}">Copiar chave</button></div></div></div>`);
}
function driverRecordForm(type,id){
 const v=minhaViagem(id);if(!v||v.status!=='Em Aberto')return toast('Esta viagem não está aberta para lançamentos.');
 if(!['despesas','abastecimentos'].includes(type))return;
 const body=type==='despesas'?`<label>Categoria<select name="categoria" required>${['Pedagio','Gastos_Pessoais_Motorista','Manutencao_Urgente','Chapa_Descarga','Outros'].map(x=>`<option value="${x}">${x.replaceAll('_',' ')}</option>`).join('')}</select></label>${moneyInput('valor','Valor (R$)')}<label>Data<input name="data" type="datetime-local" value="${dtlocal()}" required></label><label class="full">Observação<textarea name="observacao" rows="3" maxlength="500"></textarea></label>`:
 `<label>Posto de combustível<input name="posto_nome" maxlength="150" required></label>${moneyInput('litros','Litros','min="0.001" step="0.001"')}${moneyInput('valor_por_litro','Preço por litro (R$)','min="0.0001" step="0.0001"')}<label>KM no abastecimento<input name="km_no_abastecimento" type="number" min="${n(v.km_inicial)}" step="0.1" required></label>`;
 showModal(`<h2>${type==='despesas'?'Registrar gasto':'Registrar abastecimento'}</h2><p class="help">Viagem ${esc(vehicle(v.veiculo_id)?.placa||'—')} • ${esc(v.origens)} → ${esc(v.destinos)}</p><form id="motorista-record-form" class="form-grid">${body}<label class="full">Comprovante (foto ou PDF)<input name="arquivo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" required></label><p class="warning full">Confira os valores antes de salvar. Os lançamentos enviados não podem ser editados ou excluídos pelo motorista; informe o gestor se houver erro.</p><div class="full form-actions"><button class="primary" type="submit">Salvar lançamento</button></div></form>`);
 $('#motorista-record-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button[type="submit"]');if(btn.disabled)return;
  btn.disabled=true;let path=null;
  try{
   if(!minhaViagem(id)||minhaViagem(id).status!=='Em Aberto')throw Error('Viagem não está aberta.');
   const f=formData(form),file=form.elements.arquivo.files[0];if(!file)throw Error('Anexe um comprovante.');
   if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('Utilize JPG, PNG, WEBP ou PDF.');
   if(type==='abastecimentos'&&(n(f.litros)<=0||n(f.valor_por_litro)<=0||n(f.km_no_abastecimento)<n(v.km_inicial)))throw Error('Confira litros, preço e KM.');
   if(type==='despesas'&&n(f.valor)<=0)throw Error('Informe um valor positivo.');
   path=await upload(file,id);
   const row=type==='despesas'?{viagem_id:id,categoria:f.categoria,valor:n(f.valor),data:iso(f.data),observacao:f.observacao?.trim()||null,comprovante_url:path,created_by:state.user.id}:{viagem_id:id,posto_nome:f.posto_nome.trim(),litros:n(f.litros),valor_por_litro:n(f.valor_por_litro),km_no_abastecimento:n(f.km_no_abastecimento),foto_comprovante:path,created_by:state.user.id};
   await insert(type==='despesas'?'despesas_viagem':'abastecimentos',row);
   closeModal();await refresh();await motoristaTrip(id);
  }catch(ex){error(ex)}finally{btn.disabled=false}
 };
}
// ===== FIM MOTORISTA V1.2 =====

function cadastros(){if(!gestor())return goto('dashboard');main.innerHTML=title('Cadastros','Frota e motoristas disponíveis para abertura de viagens.')+
 `<div class="two"><div class="card"><div class="row"><h3>Veículos</h3><button class="primary" id="add-vehicle">+ Veículo</button></div><div class="list" style="margin-top:14px">${state.vehicles.map(v=>`<div class="item"><b>${esc(v.placa)}</b> • ${esc(v.modelo)} • ${esc(v.status)}<div class="mini">Ano ${v.ano} • KM ${v.km_inicial} • Estimativa ${v.consumo_medio_estimado||'—'} km/L</div></div>`).join('')||'Nenhum cadastrado'}</div></div>
 <div class="card"><div class="row"><h3>Motoristas</h3><button class="primary" id="add-driver">+ Motorista</button></div><div class="list" style="margin-top:14px">${state.drivers.map(v=>`<div class="item"><b>${esc(v.nome)}</b><div class="mini">Comissão ${v.comissao_percentual}% • Diária ${brl(v.valor_diaria)}</div></div>`).join('')||'Nenhum cadastrado'}</div></div></div>`;
 $('#add-vehicle').onclick=()=>registerForm('vehicle');$('#add-driver').onclick=()=>registerForm('driver');}
function registerForm(type){let body=type==='vehicle'?`<label>Placa<input name="placa" required maxlength="7" placeholder="ABC1D23"></label><label>Modelo<input name="modelo" required></label><label>Ano<input name="ano" type="number" min="1950" max="2100" required></label><label>KM atual<input name="km_inicial" type="number" step="0.1" min="0" required></label><label>Consumo médio estimado (km/L)<input name="consumo_medio_estimado" type="number" step="0.01" min="0.01"></label><label>Status<select name="status"><option>Disponível</option><option>Manutenção</option></select></label>`:
 `<label>Nome<input name="nome" required></label><label>CPF<input name="cpf" placeholder="Somente dígitos" maxlength="11"></label><label>Telefone<input name="telefone"></label><label>Chave PIX<input name="chave_pix"></label>${moneyInput('valor_diaria','Diária (R$)','value="0"')}<label>Comissão %<input name="comissao_percentual" type="number" min="0" max="100" step="0.01" value="0" required></label>`;
 showModal(`<h2>${type==='vehicle'?'Novo veículo':'Novo motorista'}</h2><form id="register-form" class="form-grid">${body}<div class="full form-actions"><button class="primary">Cadastrar</button></div></form>`);
 $('#register-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);let row=type==='vehicle'?{placa:f.placa.trim().toUpperCase(),modelo:f.modelo.trim(),ano:n(f.ano),km_inicial:n(f.km_inicial),consumo_medio_estimado:f.consumo_medio_estimado?n(f.consumo_medio_estimado):null,status:f.status}:
 {nome:f.nome.trim(),cpf:f.cpf?f.cpf.replace(/\D/g,''):null,telefone:f.telefone||null,chave_pix:f.chave_pix||null,comissao_percentual:n(f.comissao_percentual),valor_diaria:n(f.valor_diaria)};try{await insert(type==='vehicle'?'veiculos':'funcionarios',row);closeModal();await refresh();cadastros()}catch(ex){error(ex)}};
}
async function usuarios(){if(!gestor())return goto('dashboard');main.innerHTML=title('Usuários e permissões','Crie contas no painel Authentication do Supabase e associe o motorista a um funcionário.')+'<div class="card">Carregando usuários...</div>';
 try{let p=await query('profiles','id,role,funcionario_id,created_at',q=>q.order('created_at',{ascending:false}));main.innerHTML=title('Usuários e permissões','Gestores liberam contas cadastradas no Supabase Authentication.')+
 `<div class="warning">A primeira conta de gestor deve ser promovida via SQL Editor. Este painel não cria contas nem manipula senhas.</div><div class="card section"><div class="tablewrap"><table><thead><tr><th>UID Auth</th><th>Perfil</th><th>Motorista vinculado</th><th></th></tr></thead><tbody>${p.map(x=>`<tr><td><code>${esc(x.id)}</code></td><td>${esc(x.role)}</td><td>${esc(driver(x.funcionario_id)?.nome||'—')}</td><td><button class="outline" data-action="profile" data-id="${x.id}">Configurar</button></td></tr>`).join('')}</tbody></table></div></div>`;
 }catch(ex){error(ex)}}
async function profileForm(id){let [p]=await query('profiles','*',q=>q.eq('id',id));if(!p)return;showModal(`<h2>Configurar acesso</h2><p class="help">Usuário: ${esc(id)}</p><form id="profile-form" class="form-grid"><label>Perfil<select name="role"><option value="pendente">Pendente</option><option value="motorista">Motorista</option><option value="gestor">Gestor</option></select></label><label>Funcionário<select name="funcionario_id">${opts(state.drivers,d=>d.nome,'Sem vínculo')}</select></label><div class="full form-actions"><button class="primary">Salvar permissões</button></div></form>`);
 $('#profile-form [name=role]').value=p.role;$('#profile-form [name=funcionario_id]').value=p.funcionario_id||'';
 $('#profile-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);try{if(id===state.user.id&&f.role!=='gestor')throw Error('Não remova sua própria permissão de gestor.');if(f.role==='motorista'&&!f.funcionario_id)throw Error('Associe o perfil a um motorista.');await update('profiles',{role:f.role,funcionario_id:f.role==='motorista'?f.funcionario_id:null},id);closeModal();await usuarios()}catch(ex){error(ex)}};
}
async function setupSession(){const {data:{user},error:e}=await state.db.auth.getUser();if(e)throw e;state.user=user;if(!user){$('#login').hidden=false;$('#app').hidden=true;return}
 const {data:p,error:pe}=await state.db.from('profiles').select('*').eq('id',user.id).single();if(pe)throw pe;state.profile=p;if(!p||p.role==='pendente'||(p.role==='motorista'&&!p.funcionario_id)){
 $('#login').hidden=false;$('#app').hidden=true;$('#login-error').textContent='Conta autenticada, mas aguardando autorização do gestor.';return}
 $('#login').hidden=true;$('#app').hidden=false;$('#user-badge').textContent=p.role==='gestor'?'Gestor':'Motorista';$$('.manager-only').forEach(x=>x.hidden=!gestor());configureMotoristaNav();await refresh();goto(gestor()?(['motorista','motorista-historico'].includes(state.page)?'dashboard':state.page):'motorista');
}
async function initialize(){try{if(/[?&](?:password|email)=/i.test(location.search))history.replaceState(null,'',location.pathname+location.hash);if(!window.supabase)throw Error('Biblioteca Supabase não carregou. Verifique a internet.');const cfg=window.TMS_CONFIG||{};if(!cfg.supabaseUrl||cfg.supabaseUrl.includes('SEU-PROJETO')||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes('SUA_CHAVE'))throw Error('Configure web/config.js com URL e chave pública do seu Supabase.');state.db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 $('#login-form').onsubmit=async e=>{e.preventDefault();const f=formData(e.currentTarget);$('#login-error').textContent='';try{const {error:err}=await state.db.auth.signInWithPassword({email:f.email,password:f.password});if(err)throw err;await setupSession()}catch(ex){$('#login-error').textContent=ex.message}}
 $('#logout-btn').onclick=async()=>{await state.db.auth.signOut();state.user=null;state.profile=null;state.trips=[];state.motoristaSelected=null;state.driverDetail=null;await setupSession()};$('#refresh-btn').onclick=async()=>{try{await refresh();if(!gestor()&&state.motoristaSelected)await motoristaTrip(state.motoristaSelected);else render();toast('Dados atualizados.')}catch(ex){error(ex)}};
 $('#modal-close-form').onsubmit=ev=>{ev.preventDefault();closeModal()};
 document.addEventListener('click',async e=>{const nav=e.target.closest('[data-page]');if(nav){goto(nav.dataset.page);return}if(e.target.id==='new-trip'){openTripForm();return}const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;renderTab();return}const act=e.target.closest('[data-action]');if(!act)return;try{let a=act.dataset.action;if(a==='navigate')goto(act.dataset.target);if(a==='trip')await detail(act.dataset.id);if(a==='quick'){if(gestor()){state.tab=act.dataset.type;await detail(act.dataset.id);addForm(act.dataset.type)}else driverRecordForm(act.dataset.type,act.dataset.id)}if(a==='add')addForm(act.dataset.type);if(a==='xml')importXmlForm();if(a==='review')reviewForm(act.dataset.id);if(a==='file')await openFile(act.dataset.path);if(a==='profile')await profileForm(act.dataset.id);if(a==='new-cte')cteForm(act.dataset.trip||'');if(a==='view-cte')cteView(act.dataset.id);if(a==='cte-file')await cteOpenFile(act.dataset.path);if(a==='cte-copy'){await navigator.clipboard.writeText(act.dataset.key);toast('Chave de acesso copiada.')}if(a==='motorista-trip')await motoristaTrip(act.dataset.id);if(a==='motorista-add')driverRecordForm(act.dataset.type,act.dataset.id);if(a==='motorista-cte')motoristaCteView(act.dataset.id); }catch(ex){error(ex)}});
 await setupSession();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(console.warn);
 }catch(ex){$('#login-error').textContent=ex.message;console.error(ex)}}
initialize();
})();
