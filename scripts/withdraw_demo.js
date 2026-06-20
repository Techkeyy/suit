// SUIT — withdrawal helper.
//
// Recomputes the Merkle path for a deposited leaf (using the SAME keccak256
// rules as the pool contract), verifies it against the on-chain root, and
// prints a ready-to-run `stellar contract invoke ... withdraw` command.
//
// Usage:
//   node scripts/withdraw_demo.js <leafIndex> <commitmentHex> <recipientG...> <nullifierHex>
//
// For the demo we deposited a single leaf at index 0, so every sibling is the
// zero-subtree hash and every direction bit is 0 (left).

const { keccak256 } = require('js-sha3');

const DEPTH = 16;
const SEED = Buffer.from('SUIT_ZERO_LEAF_V1______________', 'ascii');

const kc = (buf) => Buffer.from(keccak256.arrayBuffer(buf));
const pair = (a, b) => kc(Buffer.concat([a, b]));
const hexToBytes = (h) => Buffer.from(h.replace(/^0x/, ''), 'hex');

function zeros() {
  const z = [kc(SEED)];
  for (let i = 1; i < DEPTH; i++) z.push(pair(z[i - 1], z[i - 1]));
  return z;
}

// Build the path for a leaf at `index`, given the list of all leaves seen so
// far. For a single-leaf tree this reduces to the zero subtrees.
function buildPath(index, leaves) {
  const z = zeros();
  const pathElements = [];
  const pathIndices = [];
  let layer = leaves.slice();
  let idx = index;
  for (let level = 0; level < DEPTH; level++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling =
      siblingIdx < layer.length ? layer[siblingIdx] : z[level];
    pathElements.push(sibling);
    pathIndices.push(isRight ? 1 : 0);
    // build next layer
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const l = layer[i];
      const r = i + 1 < layer.length ? layer[i + 1] : z[level];
      next.push(pair(l, r));
    }
    layer = next.length ? next : [z[level + 1]];
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

function computeRoot(leaf, pathElements, pathIndices) {
  let node = leaf;
  for (let i = 0; i < DEPTH; i++) {
    node =
      pathIndices[i] === 1
        ? pair(pathElements[i], node)
        : pair(node, pathElements[i]);
  }
  return node;
}

function main() {
  const [leafIndexStr, commitmentHex, recipient, nullifierHex] =
    process.argv.slice(2);
  if (!commitmentHex || !recipient || !nullifierHex) {
    console.error(
      'usage: node scripts/withdraw_demo.js <leafIndex> <commitmentHex> <recipient> <nullifierHex>'
    );
    process.exit(1);
  }
  const leafIndex = parseInt(leafIndexStr, 10);
  const leaf = hexToBytes(commitmentHex);

  // Demo assumption: this leaf is the only deposit so far.
  const { pathElements, pathIndices } = buildPath(leafIndex, [leaf]);
  const root = computeRoot(leaf, pathElements, pathIndices);

  const peCli = pathElements.map((b) => b.toString('hex'));
  const piCli = pathIndices;

  console.log('Merkle root:', root.toString('hex'));
  console.log('');
  console.log('Run:');
  console.log(
    `stellar contract invoke --id $POOL_ID --source suit-deployer --network testnet -- withdraw \\`
  );
  console.log(`  --recipient ${recipient} \\`);
  console.log(`  --nullifier ${nullifierHex.replace(/^0x/, '')} \\`);
  console.log(`  --leaf ${commitmentHex.replace(/^0x/, '')} \\`);
  console.log(`  --path_elements '${JSON.stringify(peCli)}' \\`);
  console.log(`  --path_indices '${JSON.stringify(piCli)}' \\`);
  console.log(`  --root ${root.toString('hex')}`);
}

main();
