/**
 * Sample tweets that stand in for the X API surface until OAuth credentials are
 * wired up. {@link fetchTweets} returns these so the end-to-end audit flow
 * (orchestration, progress, results) is runnable today. The shape mirrors what
 * the real X timeline endpoint returns, so swapping in the live call is a
 * drop-in replacement.
 *
 * The set deliberately mixes clean tweets with examples that trip each detector.
 * All handles/values are fictional. The credential-looking strings are bogus.
 */

/** A raw tweet as surfaced by the source (pre-detection). */
export type RawTweet = {
  /** Tweet id — string; 64-bit ids overflow JS numbers. */
  id: string;
  text: string;
  /** ISO 8601 publish time. */
  createdAt: string;
  authorHandle: string;
  /** Permalink for in-context review. */
  url: string;
  /**
   * Resolved image URLs for any media attached to the tweet (photos show
   * their native URL; videos/GIFs use the static preview frame).
   * Absent for sample tweets and posts with no media.
   */
  mediaUrls?: string[];
  /**
   * True when the tweet carries at least one photo attachment (type "photo").
   * Distinct from mediaUrls because videos/GIFs also produce a preview URL.
   * Used for billing classification: image tweets cost 4× text tweets.
   * Absent for sample tweets (treated as false / text tweet).
   */
  hasImages?: boolean;
  /** Author's profile image URL. Absent for sample tweets. */
  authorAvatarUrl?: string;
};

const HANDLE = "you";

function tweet(id: string, text: string, daysAgo: number): RawTweet {
  const createdAt = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    id,
    text,
    createdAt,
    authorHandle: HANDLE,
    url: `https://x.com/${HANDLE}/status/${id}`,
  };
}

export const SAMPLE_TWEETS: RawTweet[] = [
  tweet("1799001000000000001", "Shipped the new release tonight. Proud of the team 🚀", 1),
  tweet(
    "1799001000000000002",
    "ugh leaked my aws key in a gist again: AKIAIOSFODNN7EXAMPLE — rotating now",
    2,
  ),
  tweet("1799001000000000003", "Coffee, code, repeat. ☕️", 3),
  tweet(
    "1799001000000000004",
    "if you need me call (415) 555-0132 or email me at jane.doe@example.com",
    4,
  ),
  tweet("1799001000000000005", "Hot take: tabs > spaces and I will die on this hill", 5),
  tweet(
    "1799001000000000006",
    "test creds for the demo, ignore: api_key=sk-abc123def456ghi789jkl0",
    6,
  ),
  tweet("1799001000000000007", "Beautiful hike this weekend, highly recommend the coastal trail", 7),
  tweet(
    "1799001000000000008",
    "my ssn is 123-45-6789 don't @ me (joking… mostly)",
    8,
  ),
  tweet("1799001000000000009", "Reading a great book on distributed systems rn", 9),
  tweet(
    "1799001000000000010",
    "this is such fucking bullshit, the API docs are wrong AGAIN",
    10,
  ),
  tweet(
    "1799001000000000011",
    "got absolutely wasted last night, way too much tequila 🥴",
    11,
  ),
  tweet("1799001000000000012", "New blog post is up — link in bio", 12),
  tweet(
    "1799001000000000013",
    "I swear I'll kill you if you spoiler the finale one more time 😤",
    13,
  ),
  tweet("1799001000000000014", "Anyone else think the new UI is way cleaner?", 14),
  tweet(
    "1799001000000000015",
    "you can find him at 742 Evergreen Terrace, his real name is Walter",
    15,
  ),
  tweet("1799001000000000016", "Grateful for my mentors this year ❤️", 16),
  tweet(
    "1799001000000000017",
    "moved! my new place is 1600 Amphitheatre Pkwy if you wanna send mail",
    17,
  ),
  tweet("1799001000000000018", "Debugging a race condition for 3 hours. it was a typo.", 18),
  tweet(
    "1799001000000000019",
    "honestly some of you people are subhuman in the replies, kys 🙄",
    19,
  ),
  tweet("1799001000000000020", "Sunsets > everything 🌅", 20),
  tweet(
    "1799001000000000021",
    "DM me for nudes (kidding, it's a stock photo account now lol)",
    21,
  ),
  tweet("1799001000000000022", "Finally hit 10k steps every day this week 💪", 22),
];
