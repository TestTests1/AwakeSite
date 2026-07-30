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
}
