/**
 * A node of a doubly linked list.
 * Each node stores a value and two pointers:
 * one to the next node and one to the previous node.
 */
export class Node<T> {
  value: T;
  next: Node<T> | null;
  prev: Node<T> | null;

  constructor(value: T) {
    this.value = value;
    this.next = null;
    this.prev = null;
  }
}
