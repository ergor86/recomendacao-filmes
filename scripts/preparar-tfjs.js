// postinstall: no Windows o instalador do tfjs-node pode deixar a tensorflow.dll fora da pasta do binding.
import fs from 'node:fs';
import path from 'node:path';

if (process.platform === 'win32') {
  const base = path.join('node_modules', '@tensorflow', 'tfjs-node');
  const origem = path.join(base, 'deps', 'lib', 'tensorflow.dll');
  const destino = path.join(base, 'lib', 'napi-v8', 'tensorflow.dll');
  if (!fs.existsSync(destino)) {
    if (!fs.existsSync(origem)) {
      console.error(`preparar-tfjs: não achei ${origem} nem ${destino}; a instalação do @tensorflow/tfjs-node falhou. Apague node_modules e rode npm install de novo.`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origem, destino);
    console.log('preparar-tfjs: tensorflow.dll copiada para lib/napi-v8');
  }
}
