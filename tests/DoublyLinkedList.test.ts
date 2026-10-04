import { describe, expect, it } from 'vitest';
import { DoublyLinkedList } from '../src/structures/DoublyLinkedList';

function listOf(...values: string[]): DoublyLinkedList<string> {
  const list = new DoublyLinkedList<string>();
  values.forEach((value) => list.append(value));
  return list;
}

describe('DoublyLinkedList', () => {
  it('starts empty', () => {
    const list = new DoublyLinkedList<string>();
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
    expect(list.length).toBe(0);
    expect(list.printList()).toBe('null');
  });

  it('appends to the end and prepends to the start', () => {
    const list = listOf('B', 'C');
    list.prepend('A');
    expect(list.toArray()).toEqual(['A', 'B', 'C']);
    expect(list.head?.value).toBe('A');
    expect(list.tail?.value).toBe('C');
    expect(list.length).toBe(3);
  });

  it('keeps prev and next pointers consistent', () => {
    const list = listOf('A', 'B', 'C', 'D');
    expect(list.toArrayReverse()).toEqual(['D', 'C', 'B', 'A']);
    expect(list.head?.prev).toBeNull();
    expect(list.tail?.next).toBeNull();
    expect(list.head?.next?.prev).toBe(list.head);
  });

  it('traverses to any index from both ends', () => {
    const list = listOf('A', 'B', 'C', 'D', 'E');
    expect(list.traverseToIndex(0).value).toBe('A');
    expect(list.traverseToIndex(1).value).toBe('B');
    expect(list.traverseToIndex(3).value).toBe('D');
    expect(list.traverseToIndex(4).value).toBe('E');
    expect(() => list.traverseToIndex(5)).toThrow(RangeError);
  });

  it('inserts at the start, middle and end', () => {
    const list = listOf('B', 'D');
    list.insert(0, 'A');
    list.insert(2, 'C');
    list.insert(4, 'E');
    expect(list.toArray()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(list.toArrayReverse()).toEqual(['E', 'D', 'C', 'B', 'A']);
  });

  it('removes from the start, middle and end', () => {
    const list = listOf('A', 'B', 'C', 'D', 'E');
    expect(list.remove(0)).toBe('A');
    expect(list.remove(1)).toBe('C');
    expect(list.remove(2)).toBe('E');
    expect(list.toArray()).toEqual(['B', 'D']);
    expect(list.toArrayReverse()).toEqual(['D', 'B']);
    expect(list.head?.value).toBe('B');
    expect(list.tail?.value).toBe('D');
  });

  it('removes the only node', () => {
    const list = listOf('A');
    list.remove(0);
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
    expect(list.length).toBe(0);
  });

  it('moves a value to another position', () => {
    const list = listOf('A', 'B', 'C', 'D');
    list.move(0, 3);
    expect(list.toArray()).toEqual(['B', 'C', 'D', 'A']);
    list.move(3, 1);
    expect(list.toArray()).toEqual(['B', 'A', 'C', 'D']);
    expect(list.toArrayReverse()).toEqual(['D', 'C', 'A', 'B']);
  });

  it('prints the list', () => {
    expect(listOf('A', 'B').printList()).toBe('null <- A <-> B -> null');
  });
});
