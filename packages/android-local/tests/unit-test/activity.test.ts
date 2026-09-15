import { describe, expect, test } from '@rstest/core';

import {
  parseResolvedActivity,
  resolveActivityCommand,
  startActivityCommand,
} from '../../src/transport/activity';

describe('resolved launcher activity parsing', () => {
  test('reads the component from the last line', () => {
    const stdout = [
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
      'com.android.settings/.Settings',
      '',
    ].join('\n');

    expect(parseResolvedActivity(stdout)).toBe(
      'com.android.settings/.Settings',
    );
  });

  test('treats "No activity found" as a miss', () => {
    // The command exits 0 even then, so the miss has to be read from the text.
    expect(parseResolvedActivity('No activity found\n')).toBeUndefined();
  });

  test('requires a package/activity shape', () => {
    expect(parseResolvedActivity('com.android.settings')).toBeUndefined();
    expect(parseResolvedActivity('')).toBeUndefined();
  });

  test('rejects a line that merely contains a slash among other words', () => {
    expect(
      parseResolvedActivity('Error: unable to resolve intent { act=MAIN }'),
    ).toBeUndefined();
  });
});

describe('launch commands', () => {
  test('asks the package manager for the launcher activity', () => {
    expect(resolveActivityCommand('com.android.settings')).toBe(
      "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER 'com.android.settings'",
    );
  });

  test('starts the resolved component with am start', () => {
    expect(startActivityCommand('com.android.settings/.Settings')).toBe(
      "am start -W -n 'com.android.settings/.Settings'",
    );
  });

  test('quotes a package name that would otherwise break the shell', () => {
    // A package name is device- or config-supplied, so it is escaped as one
    // argument rather than interpolated.
    expect(resolveActivityCommand("com.x'; rm -rf /")).toBe(
      "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER 'com.x'\\''; rm -rf /'",
    );
  });
});
