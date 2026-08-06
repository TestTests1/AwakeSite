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

    /// <summary>
    /// Адрес папки с кусками локации, либо null для неизвестной локации.
    ///
    /// Отдаётся клиенту, и дальше он ходит за манифестом и кусками сам: гонять
    /// через API сотни файлов незачем, а проверка ранга остаётся здесь — адрес
    /// узнаёт только тот, кого сюда пустили. Ровно так же устроена и отдача
    /// целой модели.
    /// </summary>
    string? GetChunkBaseUrl(string location);

    /// <summary>
    /// Путь к файлу куска на диске для раздачи со стенда, либо null. На боевом
    /// не используется: там клиент ходит прямо в хранилище.
    /// </summary>
    string? GetChunkFilePath(string location, string file);
}
