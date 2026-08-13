#include <algorithm>
#include <filesystem>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <locale>
#include <map>
#include <numeric>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef FRAMEOS_WITH_MLT
#include <mlt++/Mlt.h>
#endif

namespace {

constexpr const char* worker_version = FRAMEOS_WORKER_VERSION;

std::uint16_t read_u16_le(std::istream& input) {
    unsigned char bytes[2]{};
    input.read(reinterpret_cast<char*>(bytes), 2);
    if (!input) throw std::runtime_error("Unexpected end of WAV file");
    return static_cast<std::uint16_t>(bytes[0]) |
           (static_cast<std::uint16_t>(bytes[1]) << 8U);
}

std::uint32_t read_u32_le(std::istream& input) {
    unsigned char bytes[4]{};
    input.read(reinterpret_cast<char*>(bytes), 4);
    if (!input) throw std::runtime_error("Unexpected end of WAV file");
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

void write_u16_le(std::ostream& output, const std::uint16_t value) {
    const unsigned char bytes[2] = {
        static_cast<unsigned char>(value & 0xffU),
        static_cast<unsigned char>((value >> 8U) & 0xffU),
    };
    output.write(reinterpret_cast<const char*>(bytes), 2);
}

void write_u32_le(std::ostream& output, const std::uint32_t value) {
    const unsigned char bytes[4] = {
        static_cast<unsigned char>(value & 0xffU),
        static_cast<unsigned char>((value >> 8U) & 0xffU),
        static_cast<unsigned char>((value >> 16U) & 0xffU),
        static_cast<unsigned char>((value >> 24U) & 0xffU),
    };
    output.write(reinterpret_cast<const char*>(bytes), 4);
}

std::string json_escape(const char* value) {
    if (value == nullptr) {
        return "";
    }
    std::ostringstream escaped;
    for (const unsigned char character : std::string(value)) {
        switch (character) {
        case '"': escaped << "\\\""; break;
        case '\\': escaped << "\\\\"; break;
        case '\b': escaped << "\\b"; break;
        case '\f': escaped << "\\f"; break;
        case '\n': escaped << "\\n"; break;
        case '\r': escaped << "\\r"; break;
        case '\t': escaped << "\\t"; break;
        default:
            if (character < 0x20U) {
                constexpr char hex[] = "0123456789abcdef";
                escaped << "\\u00" << hex[(character >> 4U) & 0x0fU] << hex[character & 0x0fU];
            } else {
                escaped << static_cast<char>(character);
            }
        }
    }
    return escaped.str();
}

const std::set<std::string> baseline_services = {
    "consumer:avformat",
    "producer:avformat",
    "producer:avformat-novalidate",
    "producer:color",
    "producer:xml",
    "filter:affine",
    "filter:avfilter.acompressor",
    "filter:avfilter.afade",
    "filter:avfilter.afftdn",
    "filter:avfilter.alimiter",
    "filter:avfilter.colortemperature",
    "filter:avfilter.curves",
    "filter:avfilter.eq",
    "filter:avfilter.equalizer",
    "filter:avfilter.exposure",
    "filter:avfilter.highpass",
    "filter:avfilter.highshelf",
    "filter:avfilter.loudnorm",
    "filter:avfilter.lowpass",
    "filter:avfilter.lowshelf",
    "filter:avfilter.lut3d",
    "filter:avfilter.volume",
    "filter:crop",
    "filter:panner",
    "filter:qtext",
    "link:timeremap",
    "transition:luma",
    "transition:mix",
};

const std::map<std::string, std::string> baseline_service_licenses = {
    {"producer:color", "LGPL-2.1-or-later"},
    {"producer:xml", "LGPL-2.1-or-later"},
    {"filter:affine", "LGPL-2.1-or-later"},
    {"filter:crop", "LGPL-2.1-or-later"},
    {"filter:panner", "LGPL-2.1-or-later"},
    {"filter:qtext", "LGPL-2.1-or-later"},
    {"link:timeremap", "LGPL-2.1-or-later"},
    {"transition:luma", "LGPL-2.1-or-later"},
    {"transition:mix", "LGPL-2.1-or-later"},
};

std::string service_license(const std::string& allowlist_key) {
    const auto found = baseline_service_licenses.find(allowlist_key);
    return found == baseline_service_licenses.end() ? "audit-required" : found->second;
}

#ifdef FRAMEOS_WITH_MLT
struct ServiceGroup {
    const char* kind;
    mlt_service_type type;
    mlt_properties (*list)(mlt_repository);
};

void append_service_capabilities(
    std::ostringstream& output,
    bool& first,
    mlt_repository repository,
    const ServiceGroup& group,
    std::set<std::string>& discovered_services
) {
    const mlt_properties services = group.list(repository);
    if (services == nullptr) {
        return;
    }
    const int count = mlt_properties_count(services);
    for (int index = 0; index < count; ++index) {
        const char* service_name = mlt_properties_get_name(services, index);
        if (service_name == nullptr || service_name[0] == '\0') {
            continue;
        }
        const std::string allowlist_key = std::string(group.kind) + ":" + service_name;
        discovered_services.insert(allowlist_key);
        const bool allowlisted = baseline_services.contains(allowlist_key);
        const mlt_properties metadata = mlt_repository_metadata(repository, group.type, service_name);
        const char* title = metadata == nullptr ? nullptr : mlt_properties_get(metadata, "title");
        const char* description = metadata == nullptr ? nullptr : mlt_properties_get(metadata, "description");
        const char* version = metadata == nullptr ? nullptr : mlt_properties_get(metadata, "version");
        if (!first) {
            output << ',';
        }
        first = false;
        output << "{\"id\":\"mlt." << group.kind << '.' << json_escape(service_name)
               << "\",\"kind\":\"" << group.kind
               << "\",\"name\":\"" << json_escape(title == nullptr ? service_name : title)
               << "\",\"description\":\"" << json_escape(description == nullptr ? "MLT runtime service" : description)
               << "\",\"available\":" << (allowlisted ? "true" : "false")
               << ",\"baseline\":" << (allowlisted ? "true" : "false")
               << ",\"provider\":\"mlt\",\"providerVersion\":\"" << json_escape(version == nullptr ? "7.40" : version)
               << "\",\"license\":\"" << service_license(allowlist_key) << "\",";
        if (!allowlisted) {
            output << "\"reasonUnavailable\":\"Discovered on host but not in the audited service allowlist\",";
        }
        output << "\"alternatives\":[],\"metadata\":{\"serviceName\":\"" << json_escape(service_name)
               << "\",\"allowlisted\":" << (allowlisted ? "true" : "false") << "}}";
    }
}

#endif

void append_missing_baseline_capabilities(
    std::ostringstream& output,
    bool& first,
    const std::set<std::string>& discovered_services
) {
    for (const std::string& allowlist_key : baseline_services) {
        if (discovered_services.contains(allowlist_key)) {
            continue;
        }
        const std::size_t separator = allowlist_key.find(':');
        const std::string kind = allowlist_key.substr(0, separator);
        const std::string service_name = allowlist_key.substr(separator + 1);
        if (!first) {
            output << ',';
        }
        first = false;
        output << "{\"id\":\"mlt." << kind << '.' << json_escape(service_name.c_str())
               << "\",\"kind\":\"" << kind
               << "\",\"name\":\"" << json_escape(service_name.c_str())
               << "\",\"description\":\"Audited MLT baseline service\""
               << ",\"available\":false,\"baseline\":true,\"provider\":\"mlt\""
               << ",\"providerVersion\":\"7.40\",\"license\":\""
               << service_license(allowlist_key)
               << "\",\"reasonUnavailable\":\"Audited baseline service is not installed in this worker build\""
               << ",\"alternatives\":[],\"metadata\":{\"serviceName\":\""
               << json_escape(service_name.c_str()) << "\",\"allowlisted\":true}}";
    }
}

void append_waveform_capability(std::ostringstream& output) {
    output
        << ",{\"id\":\"preview.waveform\",\"kind\":\"consumer\"," 
        << "\"name\":\"PCM waveform renderer\"," 
        << "\"description\":\"Deterministic SVG waveform generation for PCM16 little-endian WAV assets\"," 
        << "\"available\":true,\"baseline\":true,\"provider\":\"frameos-native\"," 
        << "\"providerVersion\":\"" << worker_version << "\",\"license\":\"MIT\"," 
        << "\"alternatives\":[],\"metadata\":{\"formats\":[\"wav-pcm16-le\"],\"maxWidth\":3840}}";
}

void append_proxy_capability(
    std::ostringstream& output,
    const bool available,
    const char* reason_unavailable = nullptr
) {
    output
        << ",{\"id\":\"asset.proxy.create\",\"kind\":\"consumer\"," 
        << "\"name\":\"Managed editing proxy transcoder\"," 
        << "\"description\":\"Aspect-preserving MP4 editing proxies through the audited MLT avformat adapter\"," 
        << "\"available\":" << (available ? "true" : "false")
        << ",\"baseline\":true,\"provider\":\"frameos-mlt\"," 
        << "\"providerVersion\":\"" << worker_version << "\",\"license\":\"audit-required\",";
    if (!available) {
        output << "\"reasonUnavailable\":\""
               << json_escape(reason_unavailable == nullptr ? "Proxy transcoding is unavailable" : reason_unavailable)
               << "\",";
    }
    output
        << "\"alternatives\":[],\"parameters\":{\"container\":\"mp4\",\"videoCodec\":\"mpeg4\",\"audioCodec\":\"aac\"},"
        << "\"metadata\":{\"managed\":true,\"rawPropertiesExposed\":false}}";
}

void append_thumbnail_capability(
    std::ostringstream& output,
    const bool available,
    const char* reason_unavailable = nullptr
) {
    output
        << ",{\"id\":\"asset.thumbnail.create\",\"kind\":\"consumer\"," 
        << "\"name\":\"Source-time thumbnail renderer\"," 
        << "\"description\":\"Frame-accurate bounded PNG thumbnails through the audited MLT avformat adapter\"," 
        << "\"available\":" << (available ? "true" : "false")
        << ",\"baseline\":true,\"provider\":\"frameos-mlt\"," 
        << "\"providerVersion\":\"" << worker_version << "\",\"license\":\"audit-required\",";
    if (!available) {
        output << "\"reasonUnavailable\":\""
               << json_escape(reason_unavailable == nullptr ? "Thumbnail rendering is unavailable" : reason_unavailable)
               << "\",";
    }
    output
        << "\"alternatives\":[],\"parameters\":{\"format\":\"png\",\"timeUnit\":\"milliseconds\"},"
        << "\"metadata\":{\"rawPropertiesExposed\":false}}";
}

void write_capabilities() {
#ifdef FRAMEOS_WITH_MLT
    Mlt::Factory::init();
    const mlt_repository repository = mlt_factory_repository();
    std::ostringstream output;
    output << "[{\"id\":\"engine.mlt\",\"kind\":\"producer\"," 
           << "\"name\":\"MLT editing engine\"," 
           << "\"description\":\"FrameOS native MLT editing and render worker\"," 
           << "\"available\":true,\"baseline\":true,\"provider\":\"mlt\"," 
           << "\"providerVersion\":\"7.40\",\"license\":\"LGPL-2.1\"," 
           << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
           << worker_version << "\",\"rawMltPropertiesExposed\":false}}";
    output << ",{\"id\":\"media.probe\",\"kind\":\"analyzer\"," 
           << "\"name\":\"MLT/FFmpeg media probe\","
           << "\"description\":\"Normalized stream and duration discovery through the audited avformat module\","
           << "\"available\":true,\"baseline\":true,\"provider\":\"mlt-avformat\","
           << "\"providerVersion\":\"7.40\",\"license\":\"audit-required\","
           << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
           << worker_version << "\"}}";
    output << ",{\"id\":\"preview.frame\",\"kind\":\"consumer\"," 
           << "\"name\":\"Frame preview renderer\"," 
           << "\"description\":\"Frame-accurate PNG previews through the audited MLT worker\"," 
           << "\"available\":true,\"baseline\":true,\"provider\":\"frameos-mlt\"," 
           << "\"providerVersion\":\"0.1.0\",\"license\":\"LGPL-2.1\"," 
           << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
           << worker_version << "\"}}";
    output << ",{\"id\":\"preview.region\",\"kind\":\"consumer\"," 
           << "\"name\":\"Region preview renderer\"," 
           << "\"description\":\"Frame-bounded video previews through the audited MLT worker\"," 
           << "\"available\":true,\"baseline\":true,\"provider\":\"frameos-mlt\"," 
           << "\"providerVersion\":\"0.1.0\",\"license\":\"LGPL-2.1\"," 
           << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
           << worker_version << "\"}}";
    append_waveform_capability(output);
    bool first = false;
    const std::vector<ServiceGroup> groups = {
        {"producer", mlt_service_producer_type, mlt_repository_producers},
        {"consumer", mlt_service_consumer_type, mlt_repository_consumers},
        {"filter", mlt_service_filter_type, mlt_repository_filters},
        {"link", mlt_service_link_type, mlt_repository_links},
        {"transition", mlt_service_transition_type, mlt_repository_transitions},
    };
    std::set<std::string> discovered_services;
    for (const ServiceGroup& group : groups) {
        append_service_capabilities(output, first, repository, group, discovered_services);
    }
    append_missing_baseline_capabilities(output, first, discovered_services);
    append_proxy_capability(
        output,
        discovered_services.contains("producer:avformat") &&
            discovered_services.contains("consumer:avformat"),
        "Audited avformat producer or consumer is unavailable"
    );
    append_thumbnail_capability(
        output,
        discovered_services.contains("producer:avformat") &&
            discovered_services.contains("consumer:avformat"),
        "Audited avformat producer or consumer is unavailable"
    );
    output << ']';
    std::cout << output.str() << std::endl;
    Mlt::Factory::close();
#else
    std::ostringstream output;
    output
        << "[{\"id\":\"engine.mlt\",\"kind\":\"producer\","
        << "\"name\":\"MLT editing engine\","
        << "\"description\":\"FrameOS native MLT editing and render worker\","
        << "\"available\":false,\"baseline\":true,\"provider\":\"mlt\","
        << "\"providerVersion\":\"7.40\",\"license\":\"LGPL-2.1\","
        << "\"reasonUnavailable\":\"Worker was built without FRAMEOS_WITH_MLT\","
        << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
        << worker_version << "\",\"rawMltPropertiesExposed\":false}},"
        << "{\"id\":\"media.probe\",\"kind\":\"analyzer\","
        << "\"name\":\"MLT/FFmpeg media probe\","
        << "\"description\":\"Normalized stream and duration discovery through the audited avformat module\","
        << "\"available\":false,\"baseline\":true,\"provider\":\"mlt-avformat\","
        << "\"providerVersion\":\"7.40\",\"license\":\"audit-required\","
        << "\"reasonUnavailable\":\"Worker was built without FRAMEOS_WITH_MLT\"," 
        << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
        << worker_version << "\"}},"
        << "{\"id\":\"preview.frame\",\"kind\":\"consumer\"," 
        << "\"name\":\"Frame preview renderer\"," 
        << "\"description\":\"Frame-accurate PNG previews through the audited MLT worker\"," 
        << "\"available\":false,\"baseline\":true,\"provider\":\"frameos-mlt\"," 
        << "\"providerVersion\":\"0.1.0\",\"license\":\"LGPL-2.1\"," 
        << "\"reasonUnavailable\":\"Worker was built without FRAMEOS_WITH_MLT\"," 
        << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
        << worker_version << "\"}},"
        << "{\"id\":\"preview.region\",\"kind\":\"consumer\"," 
        << "\"name\":\"Region preview renderer\"," 
        << "\"description\":\"Frame-bounded video previews through the audited MLT worker\"," 
        << "\"available\":false,\"baseline\":true,\"provider\":\"frameos-mlt\"," 
        << "\"providerVersion\":\"0.1.0\",\"license\":\"LGPL-2.1\"," 
        << "\"reasonUnavailable\":\"Worker was built without FRAMEOS_WITH_MLT\"," 
        << "\"alternatives\":[],\"metadata\":{\"workerVersion\":\""
        << worker_version << "\"}}";
    append_waveform_capability(output);
    append_proxy_capability(output, false, "Worker was built without FRAMEOS_WITH_MLT");
    append_thumbnail_capability(output, false, "Worker was built without FRAMEOS_WITH_MLT");
    bool first = false;
    append_missing_baseline_capabilities(output, first, {});
    output << ']';
    std::cout << output.str() << std::endl;
#endif
}

int probe(const std::filesystem::path& media_path) {
    if (!std::filesystem::is_regular_file(media_path)) {
        std::cerr << "Media path does not exist or is not a regular file" << std::endl;
        return 2;
    }
#ifdef FRAMEOS_WITH_MLT
    Mlt::Factory::init();
    Mlt::Profile profile;
    Mlt::Producer producer(profile, "avformat", media_path.string().c_str());
    if (!producer.is_valid()) {
        std::cerr << "MLT/FFmpeg could not probe the media file" << std::endl;
        Mlt::Factory::close();
        return 3;
    }

    const double fps = producer.get_fps() > 0.0 ? producer.get_fps() : 25.0;
    int rate_num = 25;
    int rate_den = 1;
    if (std::abs(fps - 23.976) < 0.01) {
        rate_num = 24000;
        rate_den = 1001;
    } else if (std::abs(fps - 29.97) < 0.01) {
        rate_num = 30000;
        rate_den = 1001;
    } else if (std::abs(fps - 59.94) < 0.01) {
        rate_num = 60000;
        rate_den = 1001;
    } else {
        rate_num = static_cast<int>(std::round(fps * 1000.0));
        rate_den = 1000;
        const int divisor = std::gcd(rate_num, rate_den);
        rate_num /= divisor;
        rate_den /= divisor;
    }

    std::ostringstream output;
    output << "{\"streams\":[";
    bool first = true;
    const int stream_count = std::max(0, producer.get_int("meta.media.nb_streams"));
    for (int index = 0; index < stream_count; ++index) {
        const std::string prefix = "meta.media." + std::to_string(index) + ".";
        const char* stream_type = producer.get((prefix + "stream.type").c_str());
        const std::string kind = stream_type == nullptr ? "" : stream_type;
        if (kind != "video" && kind != "audio" && kind != "subtitle" && kind != "data") {
            continue;
        }
        const char* codec = producer.get((prefix + "codec.name").c_str());
        if (!first) output << ',';
        first = false;
        output << "{\"index\":" << index
               << ",\"kind\":\"" << json_escape(kind.c_str())
               << "\",\"codec\":\"" << json_escape(codec == nullptr ? "unknown" : codec) << "\"";
        if (kind == "video") {
            const int width = producer.get_int((prefix + "codec.width").c_str());
            const int height = producer.get_int((prefix + "codec.height").c_str());
            if (width > 0) output << ",\"width\":" << width;
            if (height > 0) output << ",\"height\":" << height;
            output << ",\"frameRate\":{\"numerator\":" << rate_num
                   << ",\"denominator\":" << rate_den << '}';
        } else if (kind == "audio") {
            const int sample_rate = producer.get_int((prefix + "codec.sample_rate").c_str());
            const int channels = producer.get_int((prefix + "codec.channels").c_str());
            if (sample_rate > 0) output << ",\"sampleRate\":" << sample_rate;
            if (channels > 0) output << ",\"channels\":" << channels;
        }
        output << ",\"metadata\":{}}";
    }

    if (first) {
        const int width = producer.get_int("meta.media.width");
        const int height = producer.get_int("meta.media.height");
        const int channels = producer.get_int("meta.media.0.codec.channels");
        const char* codec = producer.get("meta.media.0.codec.name");
        if (width > 0 || height > 0) {
            output << "{\"index\":0,\"kind\":\"video\",\"codec\":\""
                   << json_escape(codec == nullptr ? "unknown" : codec) << "\"";
            if (width > 0) output << ",\"width\":" << width;
            if (height > 0) output << ",\"height\":" << height;
            output << ",\"frameRate\":{\"numerator\":" << rate_num
                   << ",\"denominator\":" << rate_den << "},\"metadata\":{}}";
            first = false;
        } else if (channels > 0) {
            const int sample_rate = producer.get_int("meta.media.0.codec.sample_rate");
            output << "{\"index\":0,\"kind\":\"audio\",\"codec\":\""
                   << json_escape(codec == nullptr ? "unknown" : codec) << "\"";
            if (sample_rate > 0) output << ",\"sampleRate\":" << sample_rate;
            output << ",\"channels\":" << channels << ",\"metadata\":{}}";
            first = false;
        }
    }
    output << ']';
    const int length = producer.get_length();
    if (length > 0) {
        output << ",\"duration\":{\"value\":" << length
               << ",\"rate\":{\"numerator\":" << rate_num
               << ",\"denominator\":" << rate_den << "}}";
    }
    output << ",\"metadata\":{\"provider\":\"mlt-avformat\",\"workerVersion\":\""
           << worker_version << "\"}}";
    std::cout << output.str() << std::endl;
    Mlt::Factory::close();
    return first ? 3 : 0;
#else
    static_cast<void>(media_path);
    std::cerr << "CAPABILITY_UNAVAILABLE: worker was built without MLT/FFmpeg" << std::endl;
    return 5;
#endif
}

int waveform(
    const std::filesystem::path& media_path,
    const std::filesystem::path& output_path,
    const int width,
    const int height,
    const int start_ms,
    const int end_ms,
    const int requested_channel
) {
    if (!std::filesystem::is_regular_file(media_path)) {
        std::cerr << "Waveform input does not exist or is not a regular file" << std::endl;
        return 2;
    }
    if (!output_path.has_filename() || !std::filesystem::exists(output_path.parent_path())) {
        std::cerr << "Waveform output directory does not exist" << std::endl;
        return 2;
    }
    if (width < 1 || width > 3840 || height < 1 || height > 2160 ||
        start_ms < 0 || end_ms < -1 || (end_ms >= 0 && end_ms <= start_ms) ||
        requested_channel < -1 || requested_channel > 63) {
        std::cerr << "Waveform dimensions, range, or channel are invalid" << std::endl;
        return 2;
    }

    try {
        std::ifstream input(media_path, std::ios::binary);
        char riff[4]{};
        char wave[4]{};
        input.read(riff, 4);
        static_cast<void>(read_u32_le(input));
        input.read(wave, 4);
        if (!input || std::string(riff, 4) != "RIFF" || std::string(wave, 4) != "WAVE") {
            throw std::runtime_error("Only RIFF WAVE input is supported");
        }

        std::uint16_t audio_format = 0;
        std::uint16_t channels = 0;
        std::uint16_t block_align = 0;
        std::uint16_t bits_per_sample = 0;
        std::uint32_t sample_rate = 0;
        std::uint32_t data_size = 0;
        std::streamoff data_offset = 0;
        while (input && (data_offset == 0 || audio_format == 0)) {
            char chunk_id[4]{};
            input.read(chunk_id, 4);
            if (!input) break;
            const std::uint32_t chunk_size = read_u32_le(input);
            const std::streamoff chunk_start = input.tellg();
            const std::string id(chunk_id, 4);
            if (id == "fmt ") {
                if (chunk_size < 16U) throw std::runtime_error("WAV fmt chunk is truncated");
                audio_format = read_u16_le(input);
                channels = read_u16_le(input);
                sample_rate = read_u32_le(input);
                static_cast<void>(read_u32_le(input));
                block_align = read_u16_le(input);
                bits_per_sample = read_u16_le(input);
            } else if (id == "data") {
                data_offset = chunk_start;
                data_size = chunk_size;
            }
            input.seekg(chunk_start + static_cast<std::streamoff>(chunk_size + (chunk_size & 1U)));
        }
        if (audio_format != 1U || bits_per_sample != 16U || channels == 0U ||
            channels > 64U || sample_rate == 0U || block_align != channels * 2U ||
            data_offset <= 0 || data_size < block_align) {
            throw std::runtime_error("Only PCM16 little-endian WAV audio is supported");
        }
        if (requested_channel >= static_cast<int>(channels)) {
            throw std::runtime_error("Requested waveform channel does not exist");
        }

        const std::uint64_t total_frames = data_size / block_align;
        const std::uint64_t start_frame = std::min(
            total_frames,
            (static_cast<std::uint64_t>(start_ms) * sample_rate) / 1000U
        );
        const std::uint64_t requested_end = end_ms < 0
            ? total_frames
            : (static_cast<std::uint64_t>(end_ms) * sample_rate + 999U) / 1000U;
        const std::uint64_t end_frame = std::min(total_frames, requested_end);
        if (end_frame <= start_frame) {
            throw std::runtime_error("Waveform range contains no audio samples");
        }
        const std::uint64_t frame_count = end_frame - start_frame;
        std::vector<double> peaks(static_cast<std::size_t>(width), 0.0);
        for (int column = 0; column < width; ++column) {
            const std::uint64_t bucket_start = start_frame +
                (frame_count * static_cast<std::uint64_t>(column)) /
                    static_cast<std::uint64_t>(width);
            std::uint64_t bucket_end = start_frame +
                (frame_count * static_cast<std::uint64_t>(column + 1)) /
                    static_cast<std::uint64_t>(width);
            if (bucket_end <= bucket_start) bucket_end = std::min(end_frame, bucket_start + 1U);
            input.clear();
            input.seekg(data_offset + static_cast<std::streamoff>(bucket_start * block_align));
            double peak = 0.0;
            for (std::uint64_t frame = bucket_start; frame < bucket_end; ++frame) {
                for (std::uint16_t channel = 0; channel < channels; ++channel) {
                    const std::uint16_t raw = read_u16_le(input);
                    if (requested_channel >= 0 && channel != requested_channel) continue;
                    const std::int16_t sample = static_cast<std::int16_t>(raw);
                    const double amplitude = std::abs(static_cast<double>(sample)) / 32768.0;
                    peak = std::max(peak, amplitude);
                }
            }
            peaks[static_cast<std::size_t>(column)] = peak;
        }

        std::ofstream output(output_path, std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not create waveform output");
        const double center = static_cast<double>(height) / 2.0;
        output << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << width
               << "\" height=\"" << height << "\" viewBox=\"0 0 " << width << ' ' << height
               << "\"><rect width=\"100%\" height=\"100%\" fill=\"#081018\"/>"
               << "<g stroke=\"#38d9c5\" stroke-width=\"1\">";
        for (int column = 0; column < width; ++column) {
            const double extent = std::max(0.5, peaks[static_cast<std::size_t>(column)] * center);
            output << "<line x1=\"" << column << "\" y1=\"" << center - extent
                   << "\" x2=\"" << column << "\" y2=\"" << center + extent << "\"/>";
        }
        output << "</g></svg>\n";
        output.close();
        if (!output) throw std::runtime_error("Could not finish waveform output");

        const std::uint64_t actual_start_ms = (start_frame * 1000U) / sample_rate;
        const std::uint64_t actual_end_ms = (end_frame * 1000U) / sample_rate;
        std::cout << "{\"status\":\"completed\",\"sampleRate\":" << sample_rate
                  << ",\"channels\":" << channels << ",\"channel\":";
        if (requested_channel < 0) std::cout << "null";
        else std::cout << requested_channel;
        std::cout << ",\"sampleFrames\":" << frame_count
                  << ",\"startMs\":" << actual_start_ms
                  << ",\"endMs\":" << actual_end_ms << "}" << std::endl;
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << std::endl;
        return 3;
    }
}

int waveform_self_test() {
    const std::filesystem::path directory = std::filesystem::temp_directory_path();
    const std::filesystem::path input_path = directory / "frameos-waveform-selftest.wav";
    const std::filesystem::path output_path = directory / "frameos-waveform-selftest.svg";
    {
        constexpr std::uint32_t sample_rate = 8000;
        constexpr std::uint32_t sample_count = 800;
        constexpr std::uint32_t data_size = sample_count * 2U;
        std::ofstream output(input_path, std::ios::binary | std::ios::trunc);
        output.write("RIFF", 4);
        write_u32_le(output, 36U + data_size);
        output.write("WAVEfmt ", 8);
        write_u32_le(output, 16U);
        write_u16_le(output, 1U);
        write_u16_le(output, 1U);
        write_u32_le(output, sample_rate);
        write_u32_le(output, sample_rate * 2U);
        write_u16_le(output, 2U);
        write_u16_le(output, 16U);
        output.write("data", 4);
        write_u32_le(output, data_size);
        for (std::uint32_t index = 0; index < sample_count; ++index) {
            const std::int16_t sample = index % 40U < 20U ? 16384 : -16384;
            write_u16_le(output, static_cast<std::uint16_t>(sample));
        }
    }
    const int result = waveform(input_path, output_path, 320, 120, 0, -1, -1);
    const bool output_valid = result == 0 && std::filesystem::is_regular_file(output_path) &&
                              std::filesystem::file_size(output_path) > 100U;
    std::error_code ignored;
    std::filesystem::remove(input_path, ignored);
    std::filesystem::remove(output_path, ignored);
    return output_valid ? 0 : 4;
}

int render(
    const std::filesystem::path& project_path,
    const std::filesystem::path& output_path,
    const int range_in,
    const int range_out,
    const char* container,
    const char* video_codec,
    const char* audio_codec,
    const char* sample_rate,
    const char* channels
) {
    if (!std::filesystem::is_regular_file(project_path)) {
        std::cerr << "Input MLT XML does not exist" << std::endl;
        return 2;
    }
    if (!output_path.has_filename() || !std::filesystem::exists(output_path.parent_path())) {
        std::cerr << "Output directory does not exist" << std::endl;
        return 2;
    }
#ifdef FRAMEOS_WITH_MLT
    Mlt::Factory::init();
    Mlt::Profile profile;
    Mlt::Producer producer(profile, "xml", project_path.string().c_str());
    if (!producer.is_valid()) {
        std::cerr << "MLT could not load the compiled project" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    if (range_in >= 0 && range_out >= range_in) {
        producer.set_in_and_out(range_in, range_out);
    }
    Mlt::Consumer consumer(profile, "avformat", output_path.string().c_str());
    if (output_path.extension() == ".png") {
        consumer.set("f", "image2");
        consumer.set("vcodec", "png");
        consumer.set("an", 1);
    }
    if (container != nullptr && container[0] != '\0') consumer.set("f", container);
    if (video_codec != nullptr && video_codec[0] != '\0') consumer.set("vcodec", video_codec);
    if (audio_codec != nullptr && audio_codec[0] != '\0') consumer.set("acodec", audio_codec);
    if (sample_rate != nullptr && sample_rate[0] != '\0') consumer.set("ar", std::stoi(sample_rate));
    if (channels != nullptr && channels[0] != '\0') consumer.set("channels", std::stoi(channels));
    if (!consumer.is_valid() || consumer.connect(producer) != 0) {
        std::cerr << "MLT could not create the output consumer" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    const int result = consumer.run();
    Mlt::Factory::close();
    if (result != 0) {
        std::cerr << "MLT render failed" << std::endl;
        return 4;
    }
    std::cout << "{\"status\":\"completed\"}" << std::endl;
    return 0;
#else
    static_cast<void>(output_path);
    static_cast<void>(range_in);
    static_cast<void>(range_out);
    static_cast<void>(container);
    static_cast<void>(video_codec);
    static_cast<void>(audio_codec);
    static_cast<void>(sample_rate);
    static_cast<void>(channels);
    std::cerr << "CAPABILITY_UNAVAILABLE: worker was built without MLT" << std::endl;
    return 5;
#endif
}

int create_proxy(
    const std::filesystem::path& media_path,
    const std::filesystem::path& output_path,
    const int max_width,
    const int max_height
) {
    if (!std::filesystem::is_regular_file(media_path)) {
        std::cerr << "Proxy source does not exist or is not a regular file" << std::endl;
        return 2;
    }
    if (max_width < 160 || max_height < 90 ||
        !output_path.has_filename() || !std::filesystem::exists(output_path.parent_path())) {
        std::cerr << "Proxy dimensions or output path are invalid" << std::endl;
        return 2;
    }
#ifdef FRAMEOS_WITH_MLT
    Mlt::Factory::init();
    Mlt::Profile source_profile;
    Mlt::Producer producer(source_profile, "avformat", media_path.string().c_str());
    if (!producer.is_valid()) {
        std::cerr << "MLT/FFmpeg could not open the proxy source" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    source_profile.from_producer(producer);
    const int metadata_width = producer.get_int("meta.media.width");
    const int metadata_height = producer.get_int("meta.media.height");
    const int source_width = std::max(
        1,
        metadata_width > 0 ? metadata_width : source_profile.width()
    );
    const int source_height = std::max(
        1,
        metadata_height > 0 ? metadata_height : source_profile.height()
    );
    const double scale = std::min({
        1.0,
        static_cast<double>(max_width) / static_cast<double>(source_width),
        static_cast<double>(max_height) / static_cast<double>(source_height),
    });
    const int output_width = std::max(
        2,
        static_cast<int>(std::floor(static_cast<double>(source_width) * scale / 2.0)) * 2
    );
    const int output_height = std::max(
        2,
        static_cast<int>(std::floor(static_cast<double>(source_height) * scale / 2.0)) * 2
    );
    Mlt::Profile output_profile;
    output_profile.set_width(output_width);
    output_profile.set_height(output_height);
    output_profile.set_frame_rate(
        source_profile.frame_rate_num(),
        source_profile.frame_rate_den()
    );
    output_profile.set_sample_aspect(
        source_profile.sample_aspect_num(),
        source_profile.sample_aspect_den()
    );
    output_profile.set_progressive(1);
    Mlt::Consumer consumer(output_profile, "avformat", output_path.string().c_str());
    consumer.set("f", "mp4");
    consumer.set("vcodec", "mpeg4");
    consumer.set("acodec", "aac");
    consumer.set("real_time", -1);
    consumer.set("threads", 0);
    if (!consumer.is_valid() || consumer.connect(producer) != 0) {
        std::cerr << "MLT could not create the proxy consumer" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    const int result = consumer.run();
    Mlt::Factory::close();
    if (result != 0) {
        std::cerr << "Proxy transcode failed" << std::endl;
        return 4;
    }
    std::cout << "{\"status\":\"completed\",\"width\":" << output_width
              << ",\"height\":" << output_height
              << ",\"container\":\"mp4\",\"videoCodec\":\"mpeg4\",\"audioCodec\":\"aac\"}"
              << std::endl;
    return 0;
#else
    static_cast<void>(output_path);
    std::cerr << "CAPABILITY_UNAVAILABLE: worker was built without MLT" << std::endl;
    return 5;
#endif
}

int create_thumbnail(
    const std::filesystem::path& media_path,
    const std::filesystem::path& output_path,
    const int time_ms,
    const int max_width,
    const int max_height
) {
    if (!std::filesystem::is_regular_file(media_path)) {
        std::cerr << "Thumbnail source does not exist or is not a regular file" << std::endl;
        return 2;
    }
    if (time_ms < 0 || max_width < 80 || max_height < 45 ||
        !output_path.has_filename() || !std::filesystem::exists(output_path.parent_path())) {
        std::cerr << "Thumbnail time, dimensions, or output path are invalid" << std::endl;
        return 2;
    }
#ifdef FRAMEOS_WITH_MLT
    Mlt::Factory::init();
    Mlt::Profile source_profile;
    Mlt::Producer producer(source_profile, "avformat", media_path.string().c_str());
    if (!producer.is_valid()) {
        std::cerr << "MLT/FFmpeg could not open the thumbnail source" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    source_profile.from_producer(producer);
    const int metadata_width = producer.get_int("meta.media.width");
    const int metadata_height = producer.get_int("meta.media.height");
    const int source_width = std::max(
        1,
        metadata_width > 0 ? metadata_width : source_profile.width()
    );
    const int source_height = std::max(
        1,
        metadata_height > 0 ? metadata_height : source_profile.height()
    );
    const double scale = std::min({
        1.0,
        static_cast<double>(max_width) / static_cast<double>(source_width),
        static_cast<double>(max_height) / static_cast<double>(source_height),
    });
    const int output_width = std::max(
        2,
        static_cast<int>(std::floor(static_cast<double>(source_width) * scale / 2.0)) * 2
    );
    const int output_height = std::max(
        2,
        static_cast<int>(std::floor(static_cast<double>(source_height) * scale / 2.0)) * 2
    );
    const int frame = static_cast<int>(std::llround(
        static_cast<double>(time_ms) * source_profile.fps() / 1000.0
    ));
    if (producer.get_length() > 0 && frame >= producer.get_length()) {
        std::cerr << "Thumbnail time is outside the source duration" << std::endl;
        Mlt::Factory::close();
        return 2;
    }
    producer.set_in_and_out(frame, frame);
    Mlt::Profile output_profile;
    output_profile.set_width(output_width);
    output_profile.set_height(output_height);
    output_profile.set_frame_rate(
        source_profile.frame_rate_num(),
        source_profile.frame_rate_den()
    );
    output_profile.set_sample_aspect(
        source_profile.sample_aspect_num(),
        source_profile.sample_aspect_den()
    );
    output_profile.set_progressive(1);
    Mlt::Consumer consumer(output_profile, "avformat", output_path.string().c_str());
    consumer.set("f", "image2");
    consumer.set("vcodec", "png");
    consumer.set("an", 1);
    consumer.set("real_time", -1);
    if (!consumer.is_valid() || consumer.connect(producer) != 0) {
        std::cerr << "MLT could not create the thumbnail consumer" << std::endl;
        Mlt::Factory::close();
        return 3;
    }
    const int result = consumer.run();
    Mlt::Factory::close();
    if (result != 0) {
        std::cerr << "Thumbnail render failed" << std::endl;
        return 4;
    }
    std::cout << "{\"status\":\"completed\",\"width\":" << output_width
              << ",\"height\":" << output_height << ",\"timeMs\":" << time_ms
              << ",\"frame\":" << frame << ",\"format\":\"png\"}" << std::endl;
    return 0;
#else
    static_cast<void>(output_path);
    std::cerr << "CAPABILITY_UNAVAILABLE: worker was built without MLT" << std::endl;
    return 5;
#endif
}

} // namespace

int main(int argc, char* argv[]) {
    std::locale::global(std::locale::classic());
    if (argc < 2) {
        std::cerr << "Usage: frameos-engine-worker <health|capabilities|probe|waveform|proxy|thumbnail|render|render-region>" << std::endl;
        return 2;
    }
    const std::string command(argv[1]);
    if (command == "health") {
        std::cout << "{\"status\":\"ok\",\"version\":\"" << worker_version << "\"}" << std::endl;
        return 0;
    }
    if (command == "capabilities") {
        write_capabilities();
        return 0;
    }
    if (command == "probe") {
        if (argc != 3) {
            std::cerr << "probe requires one media path" << std::endl;
            return 2;
        }
        return probe(std::filesystem::absolute(argv[2]));
    }
    if (command == "waveform") {
        if (argc != 9) {
            std::cerr << "waveform requires input/output/width/height/start-ms/end-ms/channel" << std::endl;
            return 2;
        }
        try {
            return waveform(
                std::filesystem::absolute(argv[2]),
                std::filesystem::absolute(argv[3]),
                std::stoi(argv[4]),
                std::stoi(argv[5]),
                std::stoi(argv[6]),
                std::stoi(argv[7]),
                std::stoi(argv[8])
            );
        } catch (...) {
            std::cerr << "waveform numeric arguments are invalid" << std::endl;
            return 2;
        }
    }
    if (command == "waveform-self-test") {
        return waveform_self_test();
    }
    if (command == "proxy") {
        if (argc != 6) {
            std::cerr << "proxy requires input/output/max-width/max-height" << std::endl;
            return 2;
        }
        int max_width = 0;
        int max_height = 0;
        try {
            max_width = std::stoi(argv[4]);
            max_height = std::stoi(argv[5]);
        } catch (...) {
            std::cerr << "proxy dimensions must be integers" << std::endl;
            return 2;
        }
        return create_proxy(
            std::filesystem::absolute(argv[2]),
            std::filesystem::absolute(argv[3]),
            max_width,
            max_height
        );
    }
    if (command == "thumbnail") {
        if (argc != 7) {
            std::cerr << "thumbnail requires input/output/time-ms/max-width/max-height" << std::endl;
            return 2;
        }
        int time_ms = 0;
        int max_width = 0;
        int max_height = 0;
        try {
            time_ms = std::stoi(argv[4]);
            max_width = std::stoi(argv[5]);
            max_height = std::stoi(argv[6]);
        } catch (...) {
            std::cerr << "thumbnail time and dimensions must be integers" << std::endl;
            return 2;
        }
        return create_thumbnail(
            std::filesystem::absolute(argv[2]),
            std::filesystem::absolute(argv[3]),
            time_ms,
            max_width,
            max_height
        );
    }
    if (command == "render") {
        if (argc != 4 && argc != 9) {
            std::cerr << "render requires MLT XML/output paths and an optional normalized profile" << std::endl;
            return 2;
        }
        return render(
            std::filesystem::absolute(argv[2]),
            std::filesystem::absolute(argv[3]),
            -1,
            -1,
            argc == 9 ? argv[4] : nullptr,
            argc == 9 ? argv[5] : nullptr,
            argc == 9 ? argv[6] : nullptr,
            argc == 9 ? argv[7] : nullptr,
            argc == 9 ? argv[8] : nullptr
        );
    }
    if (command == "render-region") {
        if (argc != 6 && argc != 11) {
            std::cerr << "render-region requires MLT XML/output/start/end and an optional normalized profile" << std::endl;
            return 2;
        }
        int range_in = 0;
        int range_out = 0;
        try {
            range_in = std::stoi(argv[4]);
            range_out = std::stoi(argv[5]);
        } catch (...) {
            std::cerr << "render-region frame bounds must be integers" << std::endl;
            return 2;
        }
        if (range_in < 0 || range_out < range_in) {
            std::cerr << "render-region frame bounds are invalid" << std::endl;
            return 2;
        }
        return render(
            std::filesystem::absolute(argv[2]),
            std::filesystem::absolute(argv[3]),
            range_in,
            range_out,
            argc == 11 ? argv[6] : nullptr,
            argc == 11 ? argv[7] : nullptr,
            argc == 11 ? argv[8] : nullptr,
            argc == 11 ? argv[9] : nullptr,
            argc == 11 ? argv[10] : nullptr
        );
    }
    std::cerr << "Unknown command" << std::endl;
    return 2;
}
