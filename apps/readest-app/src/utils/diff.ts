/**
 * Diff function similar to Linux `diff`
 * Usage: diff(str1, str2)
 */

export function diff(str1: string, str2: string) {
  const lines1 = str1.split('\n');
  const lines2 = str2.split('\n');

  const lcs = longestCommonSubsequence(lines1, lines2);

  let i = 0,
    j = 0,
    k = 0;
  const result: string[] = [];

  const addRange = (start: number, end: number) => (start === end ? `${start}` : `${start},${end}`);

  while (i < lines1.length || j < lines2.length) {
    if (k < lcs.length && i < lines1.length && lines1[i] === lcs[k]) {
      // common line
      i++;
      j++;
      k++;
    } else {
      let delStart = i,
        addStart = j;

      while (i < lines1.length && (k >= lcs.length || lines1[i] !== lcs[k])) i++;
      while (j < lines2.length && (k >= lcs.length || lines2[j] !== lcs[k])) j++;

      const delRange = addRange(delStart + 1, i);
      const addRangeStr = addRange(addStart + 1, j);

      if (delStart < i && addStart < j) {
        // change
        result.push(`${delRange}c${addRangeStr}`);
        for (let m = delStart; m < i; m++) result.push(`< ${lines1[m]}`);
        result.push('---');
        for (let m = addStart; m < j; m++) result.push(`> ${lines2[m]}`);
      } else if (delStart < i) {
        // deletion
        result.push(`${delRange}d${addStart}`);
        for (let m = delStart; m < i; m++) result.push(`< ${lines1[m]}`);
      } else if (addStart < j) {
        // addition
        result.push(`${delStart}a${addRangeStr}`);
        for (let m = addStart; m < j; m++) result.push(`> ${lines2[m]}`);
      }
    }
  }

  return result.join('\n');
}

function longestCommonSubsequence(arr1: string[], arr2: string[]) {
  const m = arr1.length;
  const n = arr2.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1] + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j], dp[i]![j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m,
    j = n;

  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j] > dp[i]![j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}
