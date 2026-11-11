// A cold device can report no activity sensor until its first model is loaded.
// This permits a first start only; it never justifies evicting an existing model.
export function emptyReadyDevice(hardware,residency,live){
  return Array.isArray(live)&&live.length===0&&hardware?.npu?.status==='ready'&&Array.isArray(hardware.occupants)&&hardware.occupants.length===0&&residency?.npu_used===0&&residency.npu_available===residency.npu_total&&residency.npu_total>0&&Array.isArray(residency.models)&&residency.models.length===0;
}
