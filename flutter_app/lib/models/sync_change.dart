class SyncChange {
  final String id;
  final String entityType; // 'daily_page' | 'note'
  final String entityId;
  final String action; // 'create' | 'update' | 'delete'
  final String data; // JSON string
  final String timestamp;
  String? syncedAt;

  SyncChange({
    required this.id,
    required this.entityType,
    required this.entityId,
    required this.action,
    required this.data,
    required this.timestamp,
    this.syncedAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'entity_type': entityType,
        'entity_id': entityId,
        'action': action,
        'data': data,
        'timestamp': timestamp,
        'synced_at': syncedAt,
      };

  factory SyncChange.fromJson(Map<String, dynamic> json) => SyncChange(
        id: json['id'] as String,
        entityType: json['entity_type'] as String,
        entityId: json['entity_id'] as String,
        action: json['action'] as String,
        data: json['data'] as String,
        timestamp: json['timestamp'] as String,
        syncedAt: json['synced_at'] as String?,
      );
}
