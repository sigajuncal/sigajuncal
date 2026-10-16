// SigaFarmácia — publicação reduzida (versão 2.0, 2026-10-16).
// Copia o repositório para _site/ e, no index.html, tira os comentários e espaços do código (JS, CSS e HTML) sem
// mudar uma única instrução. O index.html do repositório (com todos os comentários) fica exatamente como está —
// é esse que se edita e se envia ao Claude. Se alguma coisa correr mal, publica-se o original, sem reduzir.
import fs from 'fs';
import path from 'path';
import { minify } from 'terser';

const RAIZ = process.argv[2] || '.';
const SAIDA = process.argv[3] || '_site';
const IGNORAR = new Set(['.git', '.github', 'node_modules', '_site', 'package.json', 'package-lock.json']);

function copiar(orig, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const nome of fs.readdirSync(orig)) {
    if (IGNORAR.has(nome)) continue;
    const o = path.join(orig, nome), d = path.join(dest, nome);
    if (fs.statSync(o).isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
  }
}

export async function reduzirHtml(src) {
  const re = /(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/g;
  const partes = [];
  let ultimo = 0, m;
  while ((m = re.exec(src))) {
    partes.push({ tipo: 'html', texto: src.slice(ultimo, m.index) });
    partes.push({ tipo: 'js', abre: m[1], texto: m[2], fecha: m[3] });
    ultimo = m.index + m[0].length;
  }
  partes.push({ tipo: 'html', texto: src.slice(ultimo) });
  let out = '';
  for (const p of partes) {
    if (p.tipo === 'js') {
      const r = await minify(p.texto, { compress: false, mangle: false, format: { comments: false } });
      if (!r || typeof r.code !== 'string' || r.code.length < p.texto.length * 0.2) throw new Error('redução do JavaScript falhou');
      out += p.abre + r.code + p.fecha;
    } else {
      let t = p.texto.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (a, o, css, f) => o + css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n').replace(/\n[ \t]+/g, '\n') + f);
      t = t.replace(/<!--(?!\s*\[)[\s\S]*?-->/g, '');
      out += t;
    }
  }
  if (!/<meta name="siga-versao" content="[^"]*"/.test(out)) throw new Error('marca de versão em falta');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('reduzir.mjs')) {
  copiar(RAIZ, SAIDA);
  const idx = path.join(RAIZ, 'index.html');
  const src = fs.readFileSync(idx, 'utf8');
  try {
    const red = await reduzirHtml(src);
    fs.writeFileSync(path.join(SAIDA, 'index.html'), red);
    console.log(`index.html reduzido: ${(src.length / 1e6).toFixed(2)} MB → ${(red.length / 1e6).toFixed(2)} MB`);
  } catch (e) {
    console.log('AVISO: publicado o index.html original, sem reduzir —', e.message);
  }
}
