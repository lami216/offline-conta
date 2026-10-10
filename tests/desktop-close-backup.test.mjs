import test from "node:test";import assert from "node:assert/strict";import {createRequire} from "node:module";import {readFile} from "node:fs/promises";const require=createRequire(import.meta.url),{createCloseFlow,backupFilename}=require("../desktop/close-flow.cjs");
function harness(response,save={canceled:false,filePath:"/tmp/a.conta.json"},fail=false){const calls=[];const flow=createCloseFlow({dialog:{showMessageBox:async()=>({response}),showSaveDialog:async()=>save},window:()=>null,fetchBackup:async()=>{calls.push("backup");if(fail)throw Error("fail");return Buffer.from("data")},writeBackup:async()=>calls.push("write"),approveQuit:async()=>calls.push("quit"),onFailure:async()=>calls.push("failure")});return{flow,calls}}
test("YES saves before quit and cannot prompt twice",async()=>{const h=harness(0);assert.equal(await h.flow.requestClose(),true);assert.deepEqual(h.calls,["backup","write","quit"]);assert.equal(await h.flow.requestClose(),true);assert.deepEqual(h.calls,["backup","write","quit"])});
test("NO quits without backup",async()=>{const h=harness(1);assert.equal(await h.flow.requestClose(),true);assert.deepEqual(h.calls,["quit"])});
test("CANCEL and save cancellation keep app open",async()=>{let h=harness(2);assert.equal(await h.flow.requestClose(),false);assert.deepEqual(h.calls,[]);h=harness(0,{canceled:true});assert.equal(await h.flow.requestClose(),false);assert.deepEqual(h.calls,[])});
test("backup failure reports and does not quit",async()=>{const h=harness(0,undefined,true);assert.equal(await h.flow.requestClose(),false);assert.deepEqual(h.calls,["backup","failure"])});
test("filename and desktop route security/source use native backup",async()=>{assert.match(backupFilename(new Date(2026,8,1,14,5)),/^AlKarna-backup-2026-09-01-1405\.conta\.json$/);const route=await readFile(new URL("../app/api/desktop/backup/route.ts",import.meta.url),"utf8"),main=await readFile(new URL("../desktop/main.cjs",import.meta.url),"utf8");assert.match(route,/createNativeBackup\(await getDatabase\(\)\)/);assert.match(route,/timingSafeEqual/);assert.match(route,/ALKARNA_DESKTOP/);assert.match(main,/randomBytes\(32\)/);assert.ok(main.indexOf('fetchBackup')<main.indexOf('approveQuit'))});

test("desktop backup-on-exit follows the selected French locale while preserving the backup filename", async () => {
  const { closeCopy } = require("../desktop/close-flow.cjs");
  assert.match(closeCopy("fr").message, /sauvegarde/);
  assert.equal(closeCopy("unknown").title, "الكرنه");
  const dialogs = [];
  const flow = createCloseFlow({
    dialog: {
      showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; },
      showSaveDialog: async (_window, options) => { dialogs.push(options); return { canceled: false, filePath: "/tmp/ok.conta.json" }; },
    },
    window: () => null, getLocale: async () => "fr",
    fetchBackup: async () => Buffer.from("backup"), writeBackup: async () => {},
    onFailure: async () => {}, approveQuit: async () => {},
  });
  assert.equal(await flow.requestClose(), true);
  assert.equal(dialogs[0].buttons[0], "Oui, sauvegarder");
  assert.equal(dialogs[1].title, "Enregistrer la sauvegarde");
  assert.match(dialogs[1].defaultPath, /^AlKarna-backup-/);
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  assert.match(main, /const LOCALE_COOKIE='alkarna_locale'/);
  assert.match(main, /getLocale:currentLocale/);
});

test("failed backup shows just one localized error and keeps the program open", async () => {
  const dialogs = [];
  let failureLogged = 0, quits = 0;
  const flow = createCloseFlow({
    dialog: {
      showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; },
      showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/fail.conta.json" }),
    },
    window: () => null, getLocale: async () => "fr",
    fetchBackup: async () => { throw Error("offline"); },
    writeBackup: async () => {}, onFailure: async () => { failureLogged++; },
    approveQuit: async () => { quits++; },
  });
  assert.equal(await flow.requestClose(), false);
  assert.equal(failureLogged, 1);
  assert.equal(quits, 0);
  assert.equal(dialogs.length, 2, "confirmation and a single error dialog");
  assert.equal(dialogs[1].type, "error");
  assert.match(dialogs[1].message, /Impossible de créer/);
});
