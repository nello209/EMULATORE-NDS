// Worker: calcola il checksum e comprime gli stati fuori dal thread del gioco,
// cosi' il salvataggio automatico non ferma l'emulazione.
function fnv1a(data) {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

self.onmessage = async (ev) => {
  const { id, data } = ev.data;
  try {
    const checksum = fnv1a(data);
    let out = data, enc = "raw";
    if (typeof CompressionStream === "function") {
      out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      enc = "gzip";
    }
    self.postMessage({ id, checksum, out, enc }, [out.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message) });
  }
};
