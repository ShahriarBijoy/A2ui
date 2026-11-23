import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createStreamSlot, TappedMicrophoneSource } from "./micTap";

// Just enough of the browser for the SDK's MicrophoneSource: getUserMedia, MediaStream and MediaRecorder.
class FakeTrack {
  stopped = false;
  addEventListener() {}
  removeEventListener() {}
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}
class FakeRecorder {
  state = "inactive";
  addEventListener() {}
  removeEventListener() {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}

const g = globalThis as Record<string, unknown>;
const saved = { MediaStream: g.MediaStream, MediaRecorder: g.MediaRecorder, navigator: g.navigator };
beforeAll(() => {
  g.MediaStream = FakeStream;
  g.MediaRecorder = FakeRecorder;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => new FakeStream() } },
  });
});
afterAll(() => {
  g.MediaStream = saved.MediaStream;
  g.MediaRecorder = saved.MediaRecorder;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator });
});

const handlers = { onData: () => {}, onError: () => {} };
const fake = (): MediaStream => new FakeStream() as unknown as MediaStream;

describe("createStreamSlot", () => {
  test("publish notifies; release clears only its own stream", () => {
    const slot = createStreamSlot();
    let calls = 0;
    const off = slot.subscribe(() => calls++);
    const a = fake();
    const b = fake();
    const releaseA = slot.publish(a);
    expect(slot.get()).toBe(a);
    const releaseB = slot.publish(b);
    releaseA(); // the old recording's late stop
    expect(slot.get()).toBe(b);
    releaseB();
    expect(slot.get()).toBeNull();
    expect(calls).toBe(3);
    off();
    slot.publish(a);
    expect(calls).toBe(3);
  });
});

describe("TappedMicrophoneSource", () => {
  test("publishes the SDK's own stream on start and clears it on stop", async () => {
    const slot = createStreamSlot();
    const source = new TappedMicrophoneSource(slot);
    await source.start(handlers);
    const stream = slot.get();
    // Fails if the SDK stops keeping the stream on `stream`: the glow would silently stay at rest.
    expect(stream).toBeInstanceOf(FakeStream);
    source.stop();
    expect(slot.get()).toBeNull();
    expect((stream as unknown as FakeStream).track.stopped).toBe(true);
  });
  test("a previous source stopping late leaves the new press's stream alone", async () => {
    const slot = createStreamSlot();
    const first = new TappedMicrophoneSource(slot);
    const second = new TappedMicrophoneSource(slot);
    await first.start(handlers);
    await second.start(handlers);
    const current = slot.get();
    first.stop();
    expect(slot.get()).toBe(current);
    second.stop();
    expect(slot.get()).toBeNull();
  });
});
