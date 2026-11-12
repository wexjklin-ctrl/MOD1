package com.rzauto.perf;

import java.util.HashMap;

/**
 * Набор «живых» машин. Припаркованные и неподвижные пустые машины здесь НЕ состоят и не тикают вообще (стоимость 0).
 * Плотный массив: обход без аллокаций; добавление/удаление O(1) (swap-remove).
 */
public final class ActiveSet {
	private int[] ids = new int[64];
	private int size;
	private final HashMap<Integer, Integer> index = new HashMap<>();

	public boolean add(int id) {
		if (index.containsKey(id)) return false;
		if (size == ids.length) ids = java.util.Arrays.copyOf(ids, size * 2);
		ids[size] = id; index.put(id, size++);
		return true;
	}
	public boolean remove(int id) {
		Integer i = index.remove(id);
		if (i == null) return false;
		int last = ids[--size];
		if (i != size) { ids[i] = last; index.put(last, i); }
		return true;
	}
	public boolean contains(int id) { return index.containsKey(id); }
	public int size() { return size; }
	/** Обход по индексу в обратном порядке — безопасно удалять текущий элемент во время обхода. */
	public int get(int i) { return ids[i]; }
}
