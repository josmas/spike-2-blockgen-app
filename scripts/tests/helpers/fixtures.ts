/**
 * Sample programs in the code dialect, shared by several test files.
 * Lists and text are 1-based.
 */

export const BUBBLE_SORT = `function bubbleSort(list) {
  var n = list.length;
  for (var i = 1; i <= n - 1; i++) {
    for (var j = 1; j <= n - i; j++) {
      if (list[j] > list[j + 1]) {
        var temp = list[j];
        list[j] = list[j + 1];
        list[j + 1] = temp;
      }
    }
  }
  return list;
}
print(join("sorted = ", bubbleSort([3, 1, 2])));`;

export const IS_PRIME = `function isPrime(n) {
  if (n < 2) {
    return false;
  }
  for (var i = 2; i <= n - 1; i++) {
    if (n % i == 0) {
      return false;
    }
  }
  return true;
}
print(join("isPrime(7) = ", isPrime(7)));`;

/** An in-place quicksort that keeps locals across its recursive calls. */
export const QUICKSORT_WITH_LOCALS = `function quickSort(list, low, high) {
  if (low < high) {
    var pivot = list[high];
    var i = low - 1;
    for (var j = low; j <= high - 1; j++) {
      if (list[j] <= pivot) {
        i += 1;
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
    }
    var t2 = list[i + 1]; list[i + 1] = list[high]; list[high] = t2;
    quickSort(list, low, i);
    quickSort(list, i + 2, high);
  }
  return list;
}`;

/**
 * A recursive merge sort that keeps left/right/mid as locals: correct as
 * JavaScript, wrong once variables are global (what models wrote first).
 */
export const MERGE_SORT_RECURSIVE_LOCALS = `function merge(left, right) {
  var result = [];
  var i = 1;
  var j = 1;
  while (i <= left.length && j <= right.length) {
    if (left[i] <= right[j]) { result.push(left[i]); i++; } else { result.push(right[j]); j++; }
  }
  while (i <= left.length) { result.push(left[i]); i++; }
  while (j <= right.length) { result.push(right[j]); j++; }
  return result;
}
function mergeSort(list) {
  if (list.length <= 1) { return list; }
  var mid = Math.floor(list.length / 2);
  var left = [];
  var right = [];
  var i = 1;
  for (i = 1; i <= mid; i++) { left.push(list[i]); }
  for (i = mid + 1; i <= list.length; i++) { right.push(list[i]); }
  return merge(mergeSort(left), mergeSort(right));
}`;

/** A merge sort that fits the recursion rule: no locals in the recursive function. */
export const MERGE_SORT_FITS_RULE = `function copyRange(list, start, end) {
  var out = [];
  for (var i = start; i <= end; i++) { out.push(list[i]); }
  return out;
}
function merge(left, right) {
  var result = [];
  var i = 1;
  var j = 1;
  while (i <= left.length && j <= right.length) {
    if (left[i] <= right[j]) { result.push(left[i]); i++; } else { result.push(right[j]); j++; }
  }
  while (i <= left.length) { result.push(left[i]); i++; }
  while (j <= right.length) { result.push(right[j]); j++; }
  return result;
}
function mergeSort(list) {
  if (list.length <= 1) { return list; }
  return merge(mergeSort(copyRange(list, 1, Math.floor(list.length / 2))), mergeSort(copyRange(list, Math.floor(list.length / 2) + 1, list.length)));
}`;

/**
 * An iterative merge sort. Not recursive, so locals are allowed, but merge()
 * and mergeSort() both use i/left/right: they clobber each other once the
 * variables are global, unless each function's variables are renamed.
 */
export const MERGE_SORT_ITERATIVE_SHARED_NAMES = `function merge(left, right) {
  var result = [];
  var i = 1;
  var j = 1;
  while (i <= left.length || j <= right.length) {
    if (i > left.length) { result.push(right[j]); j++; }
    else if (j > right.length) { result.push(left[i]); i++; }
    else if (left[i] <= right[j]) { result.push(left[i]); i++; }
    else { result.push(right[j]); j++; }
  }
  return result;
}
function mergeSort(list) {
  var n = list.length;
  var width = 1;
  while (width < n) {
    var work = [];
    var i = 1;
    while (i <= n) {
      var left = [];
      for (var a = i; a <= i + width - 1; a++) { if (a <= n) { left.push(list[a]); } }
      var right = [];
      for (var b = i + width; b <= i + 2 * width - 1; b++) { if (b <= n) { right.push(list[b]); } }
      var merged = merge(left, right);
      for (var p = 1; p <= merged.length; p++) { work.push(merged[p]); }
      i += 2 * width;
    }
    list = work;
    width = width * 2;
  }
  return list;
}`;
