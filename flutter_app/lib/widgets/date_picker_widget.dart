import 'package:flutter/material.dart';

class DatePickerWidget extends StatelessWidget {
  final String selectedDate;
  final List<String> availableDates;
  final ValueChanged<String> onDateSelected;

  const DatePickerWidget({
    super.key,
    required this.selectedDate,
    required this.availableDates,
    required this.onDateSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        children: [
          // Quick date selector
          ...availableDates.take(7).map((date) {
            final isSelected = date == selectedDate;
            final parts = date.split('-');
            final label = '${parts[1]}/${parts[2].substring(0, 2)}';
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: ChoiceChip(
                label: Text(label, style: const TextStyle(fontSize: 12)),
                selected: isSelected,
                onSelected: (_) => onDateSelected(date),
              ),
            );
          }),
          // Date picker button
          IconButton(
            icon: const Icon(Icons.date_range),
            onPressed: () async {
              final now = DateTime.now();
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.parse(selectedDate),
                firstDate: DateTime(2020),
                lastDate: now.add(const Duration(days: 365)),
              );
              if (picked != null) {
                final formatted =
                    '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                onDateSelected(formatted);
              }
            },
          ),
        ],
      ),
    );
  }
}
