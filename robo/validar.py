#!/usr/bin/env python3
"""Confere robo/achados.json antes de publicar e mostra o resumo do dia.

Uso: python3 robo/validar.py            (a partir da raiz do repositório)
Sai com código 1 se houver ERRO.
"""
import json, os, re, sys, glob

AQUI = os.path.dirname(os.path.abspath(__file__))
erros, avisos = [], []


def carregar(caminho):
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def money(v):
    return ('R$ %.2f' % v).replace('.', ',') if v is not None else '—'


def menor(ofertas, local):
    vals = [(o['preco_unidade'], o['loja']) for o in ofertas
            if (o.get('local') == 'Manaus') == (local == 'Manaus') and isinstance(o.get('preco_unidade'), (int, float))
            and 'conferir' not in str(o.get('obs', '')).lower()]  # preço suspeito não vira "menor"
    return min(vals) if vals else (None, None)


itens_cfg = carregar(os.path.join(AQUI, 'itens.json'))['itens']
try:
    A = carregar(os.path.join(AQUI, 'achados.json'))
except Exception as e:
    print('ERRO: achados.json não abre como JSON:', e)
    sys.exit(1)

if not re.match(r'^\d{4}-\d{2}-\d{2}T', str(A.get('atualizado_em', ''))):
    erros.append('atualizado_em ausente ou fora do formato AAAA-MM-DDTHH:MM:SS-04:00')
hoje = str(A.get('atualizado_em', ''))[:10]

termos_cfg = [i['termo'] for i in itens_cfg]
termos = [i.get('termo') for i in A.get('itens', [])]
for t in termos_cfg:
    if t not in termos:
        erros.append(f'item de itens.json faltando nos achados: "{t}"')
for t in termos:
    if t not in termos_cfg:
        avisos.append(f'item nos achados que não está em itens.json: "{t}"')

CAMPOS = ['loja', 'titulo', 'url', 'preco', 'oferta_un', 'preco_unidade', 'local', 'frete_manaus', 'obs', 'data']
total = man = 0
for it in A.get('itens', []):
    t = it.get('termo')
    ofs = it.get('ofertas', [])
    if not isinstance(ofs, list):
        erros.append(f'{t}: "ofertas" precisa ser uma lista'); continue
    nM = sum(1 for o in ofs if o.get('local') == 'Manaus')
    nF = len(ofs) - nM
    total += len(ofs); man += nM
    nota = it.get('nota') or ''
    if nM == 0 and 'Manaus' not in nota:
        erros.append(f'{t}: nenhuma oferta de Manaus e a nota não explica (pesquisou Manaus?)')
    if nF == 0 and not nota:
        avisos.append(f'{t}: nenhuma oferta de fora — explique na nota')
    vals = [o['preco_unidade'] for o in ofs if isinstance(o.get('preco_unidade'), (int, float))]
    med = sorted(vals)[len(vals) // 2] if vals else None
    for k, o in enumerate(ofs):
        q = f'{t} / oferta {k + 1} ({o.get("loja", "?")})'
        for c in CAMPOS:
            if c not in o:
                erros.append(f'{q}: falta o campo "{c}"')
        if not str(o.get('url', '')).startswith('http'):
            erros.append(f'{q}: url inválida')
        if not isinstance(o.get('preco'), (int, float)) or o['preco'] <= 0:
            erros.append(f'{q}: preço inválido')
        if o.get('local') not in ('Manaus', 'online'):
            erros.append(f'{q}: local deve ser "Manaus" ou "online"')
        pu = o.get('preco_unidade')
        if pu is not None and not isinstance(pu, (int, float)):
            erros.append(f'{q}: preco_unidade deve ser número ou null')
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(o.get('data', ''))):
            erros.append(f'{q}: data fora do formato AAAA-MM-DD')
        if o.get('local') == 'Manaus' and 'manaus' in str(o.get('titulo', '')).lower() and 'durafloor' in str(o.get('titulo', '')).lower():
            avisos.append(f'{q}: "Manaus" no título pode ser nome de cor (Durafloor), não a cidade')
        if med and isinstance(pu, (int, float)) and pu < med * 0.5 and 'conferir' not in str(o.get('obs', '')):
            avisos.append(f'{q}: {money(pu)} é menos da metade da mediana ({money(med)}) — marque "conferir" em obs')

# pesquisa anterior
anteriores = sorted(p for p in glob.glob(os.path.join(AQUI, 'historico', '*.json')) if os.path.basename(p)[:10] < hoje)
ant = {}
if anteriores:
    for it in carregar(anteriores[-1]).get('itens', []):
        ant[it['termo']] = it

print('=' * 78)
print(f'Pesquisa de {hoje}: {total} ofertas ({man} de Manaus, {total - man} de fora)')
if anteriores:
    print('Comparando com', os.path.basename(anteriores[-1]))
print('=' * 78)
print(f'{"Item":36} {"📍 Manaus":>12} {"🌐 Fora":>12}  Dif.   Pesquisa anterior')
for it in A.get('itens', []):
    t, ofs = it['termo'], it.get('ofertas', [])
    vm, lm = menor(ofs, 'Manaus'); vf, lf = menor(ofs, 'online')
    dif = f'{(vm / vf - 1) * 100:+.0f}%' if vm and vf else '   '
    hist = ''
    if t in ant:
        pm, _ = menor(ant[t].get('ofertas', []), 'Manaus'); pf, _ = menor(ant[t].get('ofertas', []), 'online')
        partes = []
        if vm and pm: partes.append(f'Manaus {(vm / pm - 1) * 100:+.0f}%')
        if vf and pf: partes.append(f'fora {(vf / pf - 1) * 100:+.0f}%')
        hist = ', '.join(partes)
    print(f'{t[:36]:36} {money(vm):>12} {money(vf):>12} {dif:>5}  {hist}')
    if lm or lf:
        print(f'{"":36} {(lm or "")[:12]:>12} {(lf or "")[:12]:>12}')
promos = [(it['termo'], o) for it in A.get('itens', []) for o in it.get('ofertas', []) if o.get('promocao')]
print()
print(f'🔥 Promoções hoje: {len(promos)}')
for t, o in promos:
    print(f'  - {t[:30]}: {o.get("loja", "")} {money(o.get("preco"))} — {o["promocao"]}  {o.get("url", "")}')
print()
for a in avisos:
    print('AVISO:', a)
for e in erros:
    print('ERRO:', e)
print(f'\n{len(erros)} erro(s), {len(avisos)} aviso(s).')
sys.exit(1 if erros else 0)
