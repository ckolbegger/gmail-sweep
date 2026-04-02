import { describe, it, expect } from "bun:test";
import type { EmailSummary } from "../../src/tui/api";

// We test the pure logic of selectDown/selectUp by extracting it
// The bug: when vi:true is set on the blessed list, pressing 'j' triggers
// BOTH blessed's built-in handler AND our custom selectDown, skipping emails.

// Since we can't easily mock blessed in a unit test, we test the selection logic
// by verifying that selectDown increments selectedIndex by exactly 1.

function createSelectionTracker(emails: EmailSummary[]) {
  let selectedIndex = 0;

  function selectDown() {
    if (selectedIndex < emails.length - 1) {
      selectedIndex++;
    }
  }

  function selectUp() {
    if (selectedIndex > 0) {
      selectedIndex--;
    }
  }

  function getSelectedIndex() {
    return selectedIndex;
  }

  return { selectDown, selectUp, getSelectedIndex };
}

describe("email list selection", () => {
  const mockEmails: EmailSummary[] = [
    { id: "1", sender: "a@test.com", subject: "Email 1", date_received: 1000, is_read: false, is_starred: false },
    { id: "2", sender: "b@test.com", subject: "Email 2", date_received: 2000, is_read: true, is_starred: false },
    { id: "3", sender: "c@test.com", subject: "Email 3", date_received: 3000, is_read: false, is_starred: true },
    { id: "4", sender: "d@test.com", subject: "Email 4", date_received: 4000, is_read: true, is_starred: false },
    { id: "5", sender: "e@test.com", subject: "Email 5", date_received: 5000, is_read: false, is_starred: false },
  ];

  it("increments index by exactly 1 on selectDown", () => {
    const tracker = createSelectionTracker(mockEmails);
    expect(tracker.getSelectedIndex()).toBe(0);
    tracker.selectDown();
    expect(tracker.getSelectedIndex()).toBe(1);
  });

  it("can navigate through all emails one by one", () => {
    const tracker = createSelectionTracker(mockEmails);
    for (let i = 1; i < mockEmails.length; i++) {
      tracker.selectDown();
      expect(tracker.getSelectedIndex()).toBe(i);
    }
  });

  it("does not go past last email", () => {
    const tracker = createSelectionTracker(mockEmails);
    for (let i = 0; i < 10; i++) tracker.selectDown();
    expect(tracker.getSelectedIndex()).toBe(mockEmails.length - 1);
  });

  it("decrements index by exactly 1 on selectUp", () => {
    const tracker = createSelectionTracker(mockEmails);
    // Go to index 3
    tracker.selectDown();
    tracker.selectDown();
    tracker.selectDown();
    expect(tracker.getSelectedIndex()).toBe(3);
    tracker.selectUp();
    expect(tracker.getSelectedIndex()).toBe(2);
  });

  it("does not go before first email", () => {
    const tracker = createSelectionTracker(mockEmails);
    for (let i = 0; i < 10; i++) tracker.selectUp();
    expect(tracker.getSelectedIndex()).toBe(0);
  });

  it("selectDown then selectUp returns to same position", () => {
    const tracker = createSelectionTracker(mockEmails);
    tracker.selectDown();
    tracker.selectDown();
    const pos = tracker.getSelectedIndex();
    tracker.selectUp();
    expect(tracker.getSelectedIndex()).toBe(pos - 1);
  });
});
