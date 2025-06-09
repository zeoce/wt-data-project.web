export function extract_data(data_cls, data_nation, data_br, selected_nation, selected_br, clazz) {
  const indexes = [];
  for (let i = 0; i < data_cls.length; i++) {
    if (data_cls[i] !== clazz) continue;
    let ok = false;
    for (let j = 0; j < selected_nation.length; j++) {
      if (selected_nation[j] === data_nation[i] && selected_br[j] === data_br[i]) {
        ok = true;
        break;
      }
    }
    if (ok) indexes.push(i);
  }
  return Uint32Array.from(indexes);
}
