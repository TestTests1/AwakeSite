namespace Awake.Application.Common.Interfaces;

/// <summary>
/// Откуда брать модель локации.
///
/// Модели весят сотни мегабайт, и держать их внутри образа приложения дорого:
/// они раздувают сборку, деплой и счёт за трафик. Поэтому источник переключаемый:
/// на стенде это файл рядом с приложением, а на боевом — внешнее хранилище,
/// куда клиент уходит сам.
/// </summary>
public abstract record MapModelSource
{
    /// <summary>Файл на диске рядом с приложением.</summary>
    public sealed record LocalFile(string Path) : MapModelSource;

    /// <summary>Адрес во внешнем хранилище: клиент забирает модель оттуда напрямую.</summary>
    public sealed record RemoteUrl(string Url) : MapModelSource;
}

public interface IMapAssetService
{
    /// <summary>
    /// Где лежит модель локации, либо null, если локация неизвестна или модель
    /// не выложена. Имя локации проверяется по белому списку — произвольные
    /// пути наружу не пропускаются.
    /// </summary>
    MapModelSource? GetModelSource(string location);

    /// <summary>
    /// Известна ли локация. Отдельно от GetModelSource: расстановку заграждений
    /// можно сохранять и тогда, когда сама модель ещё не выложена.
    /// </summary>
    bool IsKnownLocation(string location);
}
