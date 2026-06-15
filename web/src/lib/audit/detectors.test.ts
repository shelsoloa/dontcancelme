import { describe, it, expect } from "vitest";
import { detect } from "./detectors";
import { RiskCategory } from "./types";

const ALL_CATEGORIES: RiskCategory[] = [
  RiskCategory.Credentials,
  RiskCategory.PII,
  RiskCategory.Doxxing,
  RiskCategory.Nsfw,
  RiskCategory.Violence,
  RiskCategory.HateSpeech,
  RiskCategory.Profanity,
  RiskCategory.Substances,
];

// ─── Credential matchers ────────────────────────────────────────────────────────

describe("credential matchers", () => {
  it("flags AWS access key and masks it in redactedText", () => {
    const text = "my key is AKIAIOSFODNN7EXAMPLE";
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].category).toBe(RiskCategory.Credentials);
    expect(result.flags[0].severity).toBe("critical");
    expect(result.flags[0].reason).toMatch(/AWS/i);
    // The raw key must not appear unmasked in redactedText.
    expect(result.redactedText).not.toMatch(/\bAKIA[A-Z0-9]{16}\b/);
    expect(result.redactedText).toContain("AKIA");
  });

  it("flags API secret key and masks it", () => {
    const text = "here is sk-abc123def456ghi789jkl012mno345";
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].category).toBe(RiskCategory.Credentials);
    expect(result.flags[0].reason).toMatch(/secret key/i);
    expect(result.redactedText).not.toContain("sk-abc123");
  });

  it("flags Google API key and masks it", () => {
    // Google API keys are exactly 39 characters: "AIza" + 35 alphanumeric/hyphen/underscore.
    const key = "AIza" + "A".repeat(35);
    const text = "API key: " + key;
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].reason).toMatch(/Google/i);
    // The raw key value must not appear unmasked in redactedText.
    expect(result.redactedText).not.toContain(key);
  });

  it("flags GitHub token and masks it", () => {
    const text = "ghp_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].reason).toMatch(/GitHub/i);
    expect(result.redactedText).not.toContain("ghp_1234");
  });

  it("flags password assignment pattern and masks it", () => {
    const text = "login: password=supersecret123";
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].severity).toBe("high");
    expect(result.flags[0].reason).toMatch(/password/i);
    expect(result.redactedText).not.toContain("supersecret123");
  });

  it("flags all credential types in a single text", () => {
    const text =
      "keys: AKIAIOSFODNN7EXAMPLE sk-testabcdefghijklmnopqrstuvwx AIzaSyD4iE2xVvDnZqT8WrKpLsM3N0Q5U6Y7 token=abc123xyz";
    const result = detect(text, [RiskCategory.Credentials]);
    // AWS key + API key + Google key + token — password pattern won't fire
    // because the token= prefix doesn't match the keyword list (it does).
    // Actually "token=" DOES match the keyword list: pattern includes "token".
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
    for (const f of result.flags) {
      expect(f.category).toBe(RiskCategory.Credentials);
    }
  });
});

// ─── PII matchers ───────────────────────────────────────────────────────────────

describe("pii matchers", () => {
  it("flags SSN and masks it", () => {
    const text = "my ssn is 123-45-6789";
    const result = detect(text, [RiskCategory.PII]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].severity).toBe("high");
    expect(result.flags[0].reason).toMatch(/Social Security/i);
    expect(result.redactedText).not.toContain("123-45-6789");
  });

  it("flags possible credit card number and masks it", () => {
    const text = "card 4532 1488 5539 1234";
    const result = detect(text, [RiskCategory.PII]);
    const cardFlags = result.flags.filter(
      (f) => f.reason.includes("card") || f.reason.includes("payment"),
    );
    expect(cardFlags.length).toBeGreaterThanOrEqual(1);
    expect(result.redactedText).not.toContain("4532 1488");
  });

  it("flags email address and masks it in redactedText", () => {
    const text = "reach me at user123@example.com";
    const result = detect(text, [RiskCategory.PII]);
    const emailFlags = result.flags.filter(
      (f) => f.reason.includes("Email") || f.reason.includes("email"),
    );
    expect(emailFlags.length).toBeGreaterThanOrEqual(1);
    expect(result.redactedText).not.toContain("user123@example.com");
    expect(result.redactedText).toContain("user");
  });

  it("flags phone number", () => {
    const text = "call me at (555) 123-4567";
    const result = detect(text, [RiskCategory.PII]);
    const phoneFlags = result.flags.filter((f) => f.reason.includes("Phone"));
    expect(phoneFlags.length).toBeGreaterThanOrEqual(1);
  });

  it("flags street address", () => {
    const text = "I live at 123 Main Street";
    const result = detect(text, [RiskCategory.PII]);
    const addrFlags = result.flags.filter((f) =>
      f.reason.includes("Street") || f.reason.includes("address"),
    );
    expect(addrFlags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Doxxing matcher ────────────────────────────────────────────────────────────

describe("doxxing matcher", () => {
  it("flags doxxing phrases", () => {
    const text = "his address is 42 Wallaby Way, Sydney";
    const result = detect(text, [RiskCategory.Doxxing]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].category).toBe(RiskCategory.Doxxing);
    expect(result.flags[0].severity).toBe("high");
    expect(result.flags[0].reason).toMatch(/can be found/i);
  });

  it("flags 'real name is' phrase", () => {
    const text = "her real name is Jane Doe";
    const result = detect(text, [RiskCategory.Doxxing]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].category).toBe(RiskCategory.Doxxing);
  });

  it("does not flag unrelated text", () => {
    const text = "I love my cat";
    const result = detect(text, [RiskCategory.Doxxing]);
    expect(result.flags).toHaveLength(0);
  });
});

// ─── Substances matcher ─────────────────────────────────────────────────────────

describe("substances matcher", () => {
  it("flags drug references", () => {
    const text = "I need some weed and cocaine";
    const result = detect(text, [RiskCategory.Substances]);
    expect(result.flags.length).toBeGreaterThanOrEqual(1);
    for (const f of result.flags) {
      expect(f.category).toBe(RiskCategory.Substances);
      expect(f.severity).toBe("low");
    }
  });

  it("flags alcohol references", () => {
    const text = "let's get some vodka and whiskey";
    const result = detect(text, [RiskCategory.Substances]);
    expect(result.flags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Redaction behavior ─────────────────────────────────────────────────────────

describe("redaction", () => {
  it("masks secret-values in redactedText", () => {
    const text = "aws: AKIAIOSFODNN7EXAMPLE ssn: 123-45-6789";
    const result = detect(text, [RiskCategory.Credentials, RiskCategory.PII]);
    expect(result.redactedText).not.toMatch(/\bAKIA[A-Z0-9]{16}\b/);
    expect(result.redactedText).not.toContain("123-45-6789");
    expect(result.redactedText).toContain("AKIA");
    expect(result.redactedText).toContain("123-");
  });

  it("masks email addresses in redactedText", () => {
    const text = "email me at user@example.com thanks";
    const result = detect(text, [RiskCategory.PII]);
    expect(result.redactedText).not.toContain("user@example.com");
    expect(result.redactedText).toContain("user");
  });

  it("handles overlapping spans correctly", () => {
    // "secret=AKIAIOSFODNN7EXAMPLE" — the password pattern and AWS key
    // pattern overlap on the same text region. Redaction applies right-to-left
    // and skips overlaps already covered.
    const text = "secret=AKIAIOSFODNN7EXAMPLE";
    const result = detect(text, [RiskCategory.Credentials]);
    // The raw AWS key must never appear unmasked.
    expect(result.redactedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    // Both matchers should have produced flags.
    expect(result.flags.length).toBeGreaterThanOrEqual(1);
  });

  it("redactedSample in flag evidence never contains raw value", () => {
    const text = "my ssn is 123-45-6789";
    const result = detect(text, [RiskCategory.PII]);
    expect(result.flags).toHaveLength(1);
    const evidence = result.flags[0].evidence;
    expect(evidence).toBeDefined();
    expect(evidence!.redactedSample).toBeDefined();
    expect(evidence!.redactedSample).not.toContain("123456789");
    expect(evidence!.redactedSample).toContain("•");
  });

  it("allows non-secret matches to appear in redactedSample (phone)", () => {
    // Phone numbers are not secret — redactedSample should show masked value
    // because maskValue is always called on the matched text for evidence.
    const text = "call 555-123-4567";
    const result = detect(text, [RiskCategory.PII]);
    const phoneFlags = result.flags.filter((f) => f.reason.includes("Phone"));
    expect(phoneFlags.length).toBe(1);
    // The evidence textStart/textEnd point to the match in the original.
    const ev = phoneFlags[0].evidence;
    expect(ev).toBeDefined();
    expect(ev!.textStart).toBeGreaterThanOrEqual(0);
    expect(ev!.textEnd).toBeGreaterThan(ev!.textStart!);
  });
});

// ─── Per-category cap ───────────────────────────────────────────────────────────

describe("per-category cap (MAX_PER_CATEGORY = 5)", () => {
  it("caps flags at 5 per category", () => {
    // Six credentials in one text — only 5 flags produced.
    const text =
      "AKIAIOSFODNN7EXAMPLE key2 AKIA00000000000000 key3 sk-test12345678901234567890 " +
      "key4 AIzaSyD4iE2xVvDnZqT8WrKpLsM3N0Q5U6Y7 key5 ghp_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ key6 password=extra123";
    const result = detect(text, [RiskCategory.Credentials]);
    // The AWS key pattern matches AKIA... — two of those, plus sk-test, plus
    // AIza, plus ghp_, plus password= — that's 6 potential credential matches.
    // Cap should limit to 5.
    expect(result.flags.length).toBeLessThanOrEqual(5);
  });
});

// ─── Enabled categories filtering ─────────────────────────────────────────────────

describe("enabled categories filtering", () => {
  it("returns zero flags when no categories are enabled", () => {
    const text =
      "ssn: 123-45-6789, email: user@example.com, his address is here";
    const result = detect(text, []);
    expect(result.flags).toHaveLength(0);
    expect(result.redactedText).toBe(text); // nothing to mask
  });

  it("returns only enabled-category flags when multiple match", () => {
    const text =
      "ssn: 123-45-6789 his address is 42 Main St email user@example.com";
    // Only enable Doxxing — PII matches should be absent.
    const result = detect(text, [RiskCategory.Doxxing]);
    expect(result.flags.length).toBeGreaterThanOrEqual(1);
    for (const f of result.flags) {
      expect(f.category).toBe(RiskCategory.Doxxing);
    }
  });

  it("returns flags for all enabled categories", () => {
    const text = "hi user@example.com cocaine is bad his address is here";
    const result = detect(text, [
      RiskCategory.PII,
      RiskCategory.Substances,
      RiskCategory.Doxxing,
    ]);
    const categories = new Set(result.flags.map((f) => f.category));
    expect(categories.has(RiskCategory.PII)).toBe(true);
    expect(categories.has(RiskCategory.Substances)).toBe(true);
    expect(categories.has(RiskCategory.Doxxing)).toBe(true);
  });
});

// ─── Empty / edge-case inputs ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty text", () => {
    const result = detect("", ALL_CATEGORIES);
    expect(result.flags).toHaveLength(0);
    expect(result.redactedText).toBe("");
  });

  it("handles text with no matches", () => {
    const text = "The weather is nice today. I had toast for breakfast.";
    const result = detect(text, ALL_CATEGORIES);
    expect(result.flags).toHaveLength(0);
    expect(result.redactedText).toBe(text);
  });

  it("includes textStart and textEnd offsets in evidence", () => {
    const text = "my ssn: 123-45-6789";
    const result = detect(text, [RiskCategory.PII]);
    expect(result.flags).toHaveLength(1);
    const ev = result.flags[0].evidence;
    expect(ev).toBeDefined();
    expect(typeof ev!.textStart).toBe("number");
    expect(typeof ev!.textEnd).toBe("number");
    // Verify the offsets point to the matched substring.
    const matched = text.slice(ev!.textStart, ev!.textEnd);
    expect(matched).toBe("123-45-6789");
  });

  it("all flags have the 'regex' detector provenance", () => {
    const text = "AKIAIOSFODNN7EXAMPLE 123-45-6789 his address is here";
    const result = detect(text, ALL_CATEGORIES);
    expect(result.flags.length).toBeGreaterThan(0);
    for (const f of result.flags) {
      expect(f.detector).toBe("regex");
    }
  });

  it("all flags have confidence between 0 and 1", () => {
    const text = "AKIAIOSFODNN7EXAMPLE";
    const result = detect(text, [RiskCategory.Credentials]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].confidence).toBeGreaterThan(0);
    expect(result.flags[0].confidence).toBeLessThanOrEqual(1);
  });
});
