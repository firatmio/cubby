import { describe, expect, test } from "bun:test";
import { statusLine } from "./html.js";
import { nameList } from "./i18n.js";
import {
  LEASE_SECONDS,
  apply,
  parseMembers,
  sharedView,
  verifySigned,
  type Action,
  type Outcome,
  type SharedState,
} from "./shared.js";

const dev = (c: string) => c.repeat(64);
const OWNER = dev("a");
const B = dev("b");
const C = dev("c");
const T0 = 1_800_000_000;

/** İşlemleri sırayla uygular; her adımın sonucunu döndürür. */
function run(steps: [Action, number?][], start: SharedState | null = null) {
  let state = start;
  const results: Outcome["result"][] = [];
  for (const [a, t] of steps) {
    const r = apply(state, a, t ?? T0);
    results.push(r.result);
    state = r.state;
  }
  return { state: state!, results };
}

const group = () =>
  run([
    [{ kind: "enable", owner: OWNER }],
    [{ kind: "members", members: [{ device: B, name: "Ayşe" }, { device: C, name: "Can" }] }],
  ]).state;

describe("ortak dünya: kurallar", () => {
  test("açılınca sahip 0. nesle sahip; ikinci kez açmak bir şey değiştirmez", () => {
    const s = group();
    expect(s.gen).toBe(0);
    expect(s.holders).toEqual({ [OWNER]: 0 });
    expect(apply(s, { kind: "enable", owner: B }, T0).state).toBe(s);
    expect(apply(null, { kind: "acquire", device: OWNER }, T0).result).toEqual({ error: "notShared" });
  });

  test("kira: aynı anda tek kişi; üye olmayan alamaz", () => {
    const { results, state } = run(
      [
        [{ kind: "acquire", device: OWNER }],
        [{ kind: "acquire", device: B }],
        [{ kind: "acquire", device: dev("d") }],
        [{ kind: "acquire", device: OWNER }, T0 + 60],
      ],
      group(),
    );
    expect(results[0]).toEqual({ ok: true });
    expect(results[1]).toEqual({ error: "busy", device: OWNER });
    expect(results[2]).toEqual({ error: "notMember" });
    expect(results[3]).toEqual({ ok: true });
    expect(state.lease).toEqual({ device: OWNER, gen: 0, until: T0 + 60 + LEASE_SECONDS });
  });

  test("en güncel nesil yoksa önce eşitleme: needSync, sonra have, sonra kira", () => {
    const { results, state } = run(
      [
        [{ kind: "acquire", device: OWNER }],
        [{ kind: "publish", device: OWNER, gen: 1 }],
        [{ kind: "release", device: OWNER }],
        [{ kind: "acquire", device: B }],
        [{ kind: "have", device: B, gen: 1 }],
        [{ kind: "acquire", device: B }],
      ],
      group(),
    );
    expect(results[3]).toEqual({ error: "needSync", gen: 1, from: [OWNER] });
    expect(results[5]).toEqual({ ok: true });
    expect(state.lease?.device).toBe(B);
    expect(state.holders).toEqual({ [OWNER]: 1, [B]: 1 });
  });

  test("publish yalnız kirayı tutan ve tam bir sonraki nesil", () => {
    const { results } = run(
      [
        [{ kind: "publish", device: OWNER, gen: 1 }],
        [{ kind: "acquire", device: OWNER }],
        [{ kind: "publish", device: OWNER, gen: 2 }],
        [{ kind: "publish", device: OWNER, gen: 1 }],
        [{ kind: "publish", device: B, gen: 2 }],
      ],
      group(),
    );
    expect(results[0]).toEqual({ error: "noLease" });
    expect(results[2]).toEqual({ error: "badGen", gen: 0 });
    expect(results[3]).toEqual({ ok: true });
    expect(results[4]).toEqual({ error: "noLease" });
  });

  test("have: var olmayan nesil reddedilir, geri gitmez", () => {
    const s = run([[{ kind: "acquire", device: OWNER }], [{ kind: "publish", device: OWNER, gen: 1 }]], group()).state;
    expect(apply(s, { kind: "have", device: B, gen: 2 }, T0).result).toEqual({ error: "badGen", gen: 1 });
    const after = run([[{ kind: "have", device: B, gen: 1 }], [{ kind: "have", device: B, gen: 0 }]], s).state;
    expect(after.holders[B]).toBe(1);
  });

  test("kira tazelenmezse düşer; en güncel hâl o cihazda kalabilir, başkası bekler", () => {
    const late = T0 + LEASE_SECONDS + 1;
    const { results, state } = run(
      [
        [{ kind: "acquire", device: OWNER }],
        [{ kind: "renew", device: OWNER }, T0 + 60],
        [{ kind: "acquire", device: B }, T0 + 60 + LEASE_SECONDS + 1],
        [{ kind: "renew", device: OWNER }, T0 + 60 + LEASE_SECONDS + 2],
      ],
      group(),
    );
    expect(results[2]).toEqual({ error: "waitFor", device: OWNER });
    expect(results[3]).toEqual({ error: "noLease" });
    expect(state.dirty).toBe(OWNER);
    // Kirli cihazın kendisi yeniden açabilir; temiz kapanış da kirliliği kaldırır.
    expect(apply(state, { kind: "acquire", device: OWNER }, late + 100).state?.dirty).toBeNull();
    expect(apply(state, { kind: "release", device: OWNER }, late + 100).state?.dirty).toBeNull();
  });

  test("force: kirli cihazın ilerlemesinden vazgeçilir, en yeni kopya yeni nesil olur", () => {
    // Sahip 2 nesil yayınladı, B 1. nesilde; sahip kirası düşerek kayboldu.
    const s = run(
      [
        [{ kind: "acquire", device: OWNER }],
        [{ kind: "publish", device: OWNER, gen: 1 }],
        [{ kind: "have", device: B, gen: 1 }],
        [{ kind: "publish", device: OWNER, gen: 2 }],
        [{ kind: "acquire", device: B }, T0 + LEASE_SECONDS + 5],
      ],
      group(),
    ).state;
    expect(s.dirty).toBe(OWNER);
    const forced = apply(s, { kind: "force" }, T0 + 1000).state!;
    expect(forced.dirty).toBeNull();
    expect(forced.gen).toBe(3);
    expect(forced.holders).toEqual({ [B]: 3 });
    expect(apply(forced, { kind: "acquire", device: B }, T0 + 1000).result).toEqual({ ok: true });
    // Sahip döndüğünde eski kopyası yetmez.
    expect(apply(forced, { kind: "acquire", device: OWNER }, T0 + 1000).result).toMatchObject({ error: "needSync", gen: 3 });
  });

  test("force: başka kimsede kopya yoksa yapılamaz", () => {
    const s = run([[{ kind: "acquire", device: B }]], { ...group(), holders: { [B]: 0 } }).state;
    const dirty = apply(s, { kind: "acquire", device: C }, T0 + LEASE_SECONDS + 1).state!;
    expect(dirty.dirty).toBe(B);
    expect(apply(dirty, { kind: "force" }, T0 + 1000).result).toEqual({ error: "noCopy" });
  });

  test("üye çıkarılınca nesli, kirası ve kirliliği silinir", () => {
    const s = run([[{ kind: "have", device: B, gen: 0 }], [{ kind: "acquire", device: B }]], group()).state;
    const out = apply(s, { kind: "members", members: [{ device: C, name: "Can" }] }, T0).state!;
    expect(out.lease).toBeNull();
    expect(out.holders[B]).toBeUndefined();
    expect(apply(out, { kind: "acquire", device: B }, T0).result).toEqual({ error: "notMember" });
  });

  test("üye listesi doğrulaması", () => {
    expect(parseMembers([{ device: B, name: "  Ayşe\u0007 " }, { device: B, name: "x" }, { device: OWNER, name: "ben" }], OWNER)).toEqual([
      { device: B, name: "Ayşe" },
    ]);
    expect(parseMembers([{ device: "zz", name: "x" }], OWNER)).toBeNull();
    expect(parseMembers("x", OWNER)).toBeNull();
    expect(parseMembers(Array.from({ length: 17 }, (_, i) => ({ device: (i + 1).toString(16).padStart(64, "0"), name: "x" })), OWNER)).toBeNull();
  });
});

describe("ortak dünya: imza", () => {
  // Aşama 0'daki Rust vektörü (spike_shared::spike_sign): iroh SecretKey::from_bytes([7; 32]).
  const PUB = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
  const MSG = "cubby lease K7M2QX gen=3 t=1793130000";
  const SIG =
    "a02cedbd50febaf9de8a6da9bf3280d258239455949e59165ad81f010eceea9b0d1c5f39cc1488a1a4d8c5b452583cc759de136bb0853a83e4d6974e207dc20b";

  test("iroh imzası WebCrypto'da doğrulanır", async () => {
    const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const key = await crypto.subtle.importKey("raw", hex(PUB), { name: "Ed25519" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, hex(SIG), new TextEncoder().encode(MSG))).toBe(true);
  });

  // Uçtan uca: WebCrypto ile üretilen anahtar, uygulamanın atacağı biçimde imzalar.
  async function signer() {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const device = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    const sign = async (payload: object) => {
      const text = JSON.stringify(payload);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(text)));
      return { payload: text, sig: [...sig].map((b) => b.toString(16).padStart(2, "0")).join("") };
    };
    return { device, sign };
  }
  const base = (device: string) => ({ v: 1, action: "acquire", code: "K7M2QX", device, t: T0, nonce: "0".repeat(32) });

  test("geçerli istek okunur", async () => {
    const s = await signer();
    const p = await verifySigned(await s.sign({ ...base(s.device), gen: 3 }), "K7M2QX", T0 + 10);
    expect(p).toMatchObject({ action: "acquire", device: s.device, gen: 3 });
  });

  test("değiştirilmiş, eski, başka koda ait ya da bozuk istek reddedilir", async () => {
    const s = await signer();
    const ok = await s.sign(base(s.device));
    expect(await verifySigned({ ...ok, payload: ok.payload.replace("acquire", "release") }, "K7M2QX", T0)).toBe("bad_signature");
    expect(await verifySigned(ok, "K7M2QX", T0 + 301)).toBe("stale");
    expect(await verifySigned(ok, "ABC234", T0)).toBe("bad_request");
    const other = await signer();
    expect(await verifySigned(await other.sign(base(s.device)), "K7M2QX", T0)).toBe("bad_signature");
    expect(await verifySigned(await s.sign({ ...base(s.device), action: "delete" }), "K7M2QX", T0)).toBe("bad_request");
    expect(await verifySigned(await s.sign({ ...base(s.device), gen: -1 }), "K7M2QX", T0)).toBe("bad_request");
    expect(await verifySigned({ payload: "{", sig: "0".repeat(128) }, "K7M2QX", T0)).toBe("bad_request");
    expect(await verifySigned(null, "K7M2QX", T0)).toBe("bad_request");
  });
});

describe("ortak dünya: sayfa", () => {
  const s = group();

  test("ad listesi", () => {
    expect(nameList("tr", ["Ali"])).toBe("Ali");
    expect(nameList("tr", ["Ali", "Ayşe"])).toBe("Ali ya da Ayşe");
    expect(nameList("tr", ["Ali", "Ayşe", "Can"])).toBe("Ali, Ayşe ya da Can");
    expect(nameList("en", ["Ali", "Ayşe", "Can", "Deniz"])).toBe("Ali, Ayşe and 2 more");
  });

  test("kapalıyken kimlerin açabileceği, açıkken kimin açtığı, beklerken kimin beklendiği", () => {
    expect(statusLine("tr", { state: "closed" }, sharedView(s, "Ali", T0))?.text).toBe("Şu an kapalı · Ali, Ayşe ya da Can açabilir");
    const open = apply(s, { kind: "acquire", device: OWNER }, T0).state;
    expect(statusLine("tr", { state: "open", players: 2, maxPlayers: 10 }, sharedView(open, "Ali", T0))?.text).toBe(
      "Açık · Ali açtı · 2 oyuncu oyunda",
    );
    const waiting = sharedView(open, "Ali", T0 + LEASE_SECONDS + 1);
    expect(statusLine("en", null, waiting)?.text).toBe("Closed right now · you can join once Ali opens it");
    // Ortak dünya değilse eskisi gibi.
    expect(statusLine("tr", { state: "closed" }, null)?.text).toBe("Şu an kapalı · arkadaşın açınca girebilirsin");
    expect(statusLine("tr", null, null)).toBeNull();
  });
});
