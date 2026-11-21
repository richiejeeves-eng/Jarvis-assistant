package com.richiejeeves.healthconnect

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.reflect.KClass

/**
 * Single source of truth for converting approved Health Connect records
 * into the payload accepted by the health-sync Edge Function.
 */
internal object HealthRecordReader {
    suspend fun read(client: HealthConnectClient, granted: Set<String>): JSONArray {
        val output = JSONArray()
        val now = Instant.now()
        val range = TimeRangeFilter.between(now.minus(30, ChronoUnit.DAYS), now)

        fun add(
            type: String,
            id: String,
            start: Instant,
            end: Instant,
            value: JSONObject,
            source: String?,
            device: String?
        ) {
            output.put(
                JSONObject()
                    .put("record_type", type)
                    .put("external_id", id.ifBlank { "$type-$start" })
                    .put("start_time", start.toString())
                    .put("end_time", end.toString())
                    .put("value", value)
                    .put("source_app", source ?: JSONObject.NULL)
                    .put("source_device", device ?: JSONObject.NULL)
            )
        }

        if (HealthPermission.getReadPermission(StepsRecord::class) in granted) {
            val today = LocalDate.now()
            for (daysAgo in 29 downTo 0) {
                val day = today.minusDays(daysAgo.toLong())
                val start = day.atStartOfDay(ZoneId.systemDefault()).toInstant()
                val end = minOf(day.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant(), now)
                if (end <= start) continue
                val count = client.aggregate(
                    AggregateRequest(
                        setOf(StepsRecord.COUNT_TOTAL),
                        TimeRangeFilter.between(start, end)
                    )
                )[StepsRecord.COUNT_TOTAL] ?: 0L
                if (count > 0) {
                    add("steps", "steps-$day", start, end, JSONObject().put("count", count), "Health Connect", null)
                }
            }
        }

        if (HealthPermission.getReadPermission(HeartRateRecord::class) in granted) {
            readAll(client, HeartRateRecord::class, range).forEach { record ->
                val samples = JSONArray()
                record.samples.forEach { sample ->
                    samples.put(JSONObject().put("bpm", sample.beatsPerMinute).put("time", sample.time.toString()))
                }
                add("heart_rate", record.metadata.id, record.startTime, record.endTime,
                    JSONObject().put("samples", samples), record.metadata.dataOrigin.packageName, record.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) {
            readAll(client, SleepSessionRecord::class, range).forEach { record ->
                add("sleep", record.metadata.id, record.startTime, record.endTime,
                    JSONObject()
                        .put("duration_minutes", ChronoUnit.MINUTES.between(record.startTime, record.endTime))
                        .put("stage_count", record.stages.size),
                    record.metadata.dataOrigin.packageName, record.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(WeightRecord::class) in granted) {
            readAll(client, WeightRecord::class, range).forEach { record ->
                add("weight", record.metadata.id, record.time, record.time,
                    JSONObject().put("kg", record.weight.inKilograms),
                    record.metadata.dataOrigin.packageName, record.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(BodyFatRecord::class) in granted) {
            readAll(client, BodyFatRecord::class, range).forEach { record ->
                add("body_fat", record.metadata.id, record.time, record.time,
                    JSONObject().put("percentage", record.percentage.value),
                    record.metadata.dataOrigin.packageName, record.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(BloodPressureRecord::class) in granted) {
            readAll(client, BloodPressureRecord::class, range).forEach { record ->
                add("blood_pressure", record.metadata.id, record.time, record.time,
                    JSONObject()
                        .put("systolic_mmhg", record.systolic.inMillimetersOfMercury)
                        .put("diastolic_mmhg", record.diastolic.inMillimetersOfMercury)
                        .put("measurement_location", record.measurementLocation),
                    record.metadata.dataOrigin.packageName, record.metadata.device?.model)
            }
        }

        return output
    }

    private suspend fun <T : Record> readAll(
        client: HealthConnectClient,
        recordType: KClass<T>,
        range: TimeRangeFilter
    ): List<T> {
        val records = mutableListOf<T>()
        var pageToken: String? = null
        do {
            val page = client.readRecords(
                ReadRecordsRequest(recordType, timeRangeFilter = range, pageSize = 1000, pageToken = pageToken)
            )
            records.addAll(page.records)
            pageToken = page.pageToken
        } while (pageToken != null)
        return records
    }
}
