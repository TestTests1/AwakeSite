using Awake.Application.Common.Interfaces;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace Awake.Infrastructure.ExternalServices.Maps;

public class MapAssetService(IWebHostEnvironment environment, IConfiguration configuration)
    : IMapAssetService
{
    private const string AssetDirectory = "MapAssets";

    /// <summary>
    /// Локация приходит из URL, поэтому подставлять её в путь напрямую нельзя —
    /// иначе "../../appsettings.json" отдал бы наружу произвольный файл.
    /// Белый список решает это надёжнее любой чистки строки: имя либо есть в
    /// наборе, либо запроса просто не существует.
    /// </summary>
    private static readonly HashSet<string> KnownLocations =
        new(StringComparer.OrdinalIgnoreCase) { "hvoiny", "small_berdovka", "nizina" };

    /// <summary>
    /// Адрес внешнего хранилища моделей. Пусто — раздаём с диска, как на стенде.
    /// </summary>
    private string? BaseUrl
    {
        get
        {
            var value = configuration["MapAssets:BaseUrl"];
            return string.IsNullOrWhiteSpace(value) ? null : value.TrimEnd('/');
        }
    }

    public bool IsKnownLocation(string location) => KnownLocations.Contains(location);

    public MapModelSource? GetModelSource(string location)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;

        // Имя берётся из белого списка, а не из запроса, поэтому подставлять его
        // в адрес безопасно.
        var baseUrl = BaseUrl;
        if (baseUrl is not null)
            return new MapModelSource.RemoteUrl($"{baseUrl}/{canonical}.glb");

        var path = Path.Combine(environment.ContentRootPath, AssetDirectory, $"{canonical}.glb");
        return File.Exists(path) ? new MapModelSource.LocalFile(path) : null;
    }

    /// <summary>
    /// Адрес нарезки под куски. Отдельный ключ, а не производный от
    /// MapAssets:BaseUrl: тот указывает на папку v1 с целыми моделями, и она
    /// обязана продолжать работать, пока стриминг не проверен на всех трёх
    /// картах. Считать один адрес из другого значило бы сломать старый путь той
    /// же правкой, которой чиним новый.
    /// </summary>
    private string? ChunkBaseUrl
    {
        get
        {
            var value = configuration["MapAssets:ChunkBaseUrl"];
            return string.IsNullOrWhiteSpace(value) ? null : value.TrimEnd('/');
        }
    }

    /// <summary>
    /// Папка с кусками локации. На стенде хранилища нет, поэтому куски отдаёт
    /// само приложение.
    /// </summary>
    public string? GetChunkBaseUrl(string location)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;

        var baseUrl = ChunkBaseUrl;
        return baseUrl is not null
            ? $"{baseUrl}/{canonical}/"
            : $"/api/maps/{canonical}/chunks/";
    }

    /// <summary>
    /// Путь к файлу куска на диске, либо null.
    ///
    /// Имя файла приходит из запроса, поэтому проверяется образцом, а не
    /// чисткой строки: подходит только манифест, общий файл материалов и кусок
    /// вида c_&lt;число&gt;_&lt;число&gt;.glb. Всё остальное — не существует.
    /// </summary>
    public string? GetChunkFilePath(string location, string file)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;
        if (!ChunkFileName.IsMatch(file))
            return null;

        var path = Path.Combine(environment.ContentRootPath, AssetDirectory, "v2", canonical, file);
        return File.Exists(path) ? path : null;
    }

    private static readonly System.Text.RegularExpressions.Regex ChunkFileName =
        new(@"^(manifest\.json|materials\.glb|c_-?\d+_-?\d+\.glb)$",
            System.Text.RegularExpressions.RegexOptions.Compiled);
}
